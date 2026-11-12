import { Options } from "./types/index.js";
import { getApiVersion } from "./config/apiVersion.js";
import { acceptedToolsFor } from "./config/acceptedTools.js";
import { assertTestCredentials, liveAllowedByEnv } from "./config/livePolicy.js";
import {
    RAW_CARD_SWITCH_HINT,
    RAW_CARD_TOOLS,
    rawCardToolsAllowedByEnv,
} from "./config/rawCardTools.js";

const ACCEPTED_ARGS = ['tools', 'allow-live', 'enable-raw-card-tools'];

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
            } else if (key === 'allow-live') {
                options.allowLive = true;
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

    options.allowLive = options.allowLive === true || liveAllowedByEnv(env);
    assertTestCredentials(apiVersion, options.allowLive, env);
    if (options.allowLive) {
        console.error('WARNING: live mode is on. Tools can move real money.');
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
