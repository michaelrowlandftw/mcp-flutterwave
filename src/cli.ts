import { Options } from "./types/index.js";
import { getApiVersion } from "./config/apiVersion.js";
import { acceptedToolsFor } from "./config/acceptedTools.js";
import { assertTestCredentials } from "./config/livePolicy.js";
import {
    RAW_CARD_SWITCH_HINT,
    RAW_CARD_TOOLS,
    rawCardToolsAllowedByEnv,
} from "./config/rawCardTools.js";
import { isReadOnlyTool } from "./config/toolSafety.js";

const ACCEPTED_ARGS = ['tools', 'enable-raw-card-tools', 'read-only'];

export function parseArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
): Options {
    const options: Options = {};

    args.forEach((arg) => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');

            if (key === 'tools') {
                options.tools = (value ?? '').split(',');
            } else if (key === 'read-only') {
                if (value !== undefined && value !== 'true' && value !== 'false') {
                    throw new Error('--read-only takes no value, or =true or =false.');
                }
                options.readOnly = value !== 'false';
            } else if (key === 'enable-raw-card-tools') {
                options.rawCardTools = true;
            } else {
                throw new Error(
                    `Invalid argument: ${key}. Accepted arguments are: ${ACCEPTED_ARGS.join(
                        ', '
                    )}`
                );
            }
        }
    });

    // Check if required tools arguments is present.
    if (!options.tools) {
        throw new Error('The --tools arguments must be provided.');
    }

    const apiVersion = getApiVersion(env);
    const acceptedTools = acceptedToolsFor(apiVersion);
    const acceptedToolsSet = new Set<string>(acceptedTools);

    // Validate tools against the version that this process is registered for.
    options.tools.forEach((tool: string) => {
        const trimmedTool = tool.trim();
        if (trimmedTool === 'all') {
            return;
        }
        if (!acceptedToolsSet.has(trimmedTool)) {
            throw new Error(
                `Invalid tool: ${tool}. Accepted tools are: ${acceptedTools.join(
                    ', '
                )}`
            );
        }
    });

    options.rawCardTools =
        options.rawCardTools === true || rawCardToolsAllowedByEnv(env);
    const listedCardTools = options.tools
        .map((tool) => tool.trim())
        .filter((tool) => RAW_CARD_TOOLS.has(tool));
    if (!options.rawCardTools && listedCardTools.length > 0) {
        throw new Error(
            `${listedCardTools.join(', ')} take raw card data (card number, CVV or PIN) through the AI model, which is a PCI DSS risk. ${RAW_CARD_SWITCH_HINT}`
        );
    }
    if (options.rawCardTools) {
        console.error(
            'WARNING: raw card tools are on. Card numbers, CVVs and PINs will pass through the AI model. Use test cards only unless you are PCI DSS compliant.'
        );
    }

    assertTestCredentials(apiVersion, env);

    // Read-only: explicit flag, then FLW_READ_ONLY. Off by default.
    if (options.readOnly === undefined) {
        options.readOnly = env.FLW_READ_ONLY === 'true';
    }
    if (options.readOnly) {
        const writes = options.tools
            .map((tool) => tool.trim())
            .filter((tool) => tool !== 'all' && !isReadOnlyTool(tool));
        if (writes.length > 0) {
            throw new Error(
                `Read-only mode is on, so these tools cannot be registered: ${writes.join(', ')}. Pass --read-only=false or set FLW_READ_ONLY=false to allow writes.`
            );
        }
        console.error('Read-only mode: only tools that read data are registered.');
    }

    if (apiVersion === 'v3') {
        const apiKey = env.FLW_SECRET_KEY;

        if (!apiKey) {
            throw new Error(
                'Flutterwave Secret key not provided. Set the FLW_SECRET_KEY environment variable.'
            );
        }

        options.apiKey = apiKey;
    }

    return options;
}
