import { Options } from "./types/index.js";
import { getApiVersion } from "./config/apiVersion.js";
import { acceptedToolsFor } from "./config/acceptedTools.js";
import { assertTestCredentials, credentialsAreLive } from "./config/livePolicy.js";
import { isReadOnlyTool } from "./config/toolSafety.js";

const ACCEPTED_ARGS = ['tools', 'read-only'];

/**
 * Raw card tools were removed from the package (Security review of DX-RFC-001,
 * decided 2026-11-22). The old switch now stops start-up, so nobody believes it
 * still does something.
 */
export const RAW_CARD_REMOVED =
    'Raw card tools (charge_card, create_card_payment_method, create_orchestrator_charge, create_orchestrator_order and the PIN path of update_charge) were removed: card numbers, CVVs and PINs must not pass through the AI model. Use hosted checkout (create_checkout, create_order) or a tokenised charge of a card saved from a 3DS checkout (charge_tokenized_card). Remove --enable-raw-card-tools and FLW_ENABLE_RAW_CARD_TOOLS.';

export function parseArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
): Options {
    const options: Options = {};
    let readOnlyFlag: boolean | undefined;

    args.forEach((arg) => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');

            if (key === 'tools') {
                options.tools = (value ?? '').split(',');
            } else if (key === 'read-only') {
                if (value !== undefined && value !== 'true' && value !== 'false') {
                    throw new Error('--read-only takes no value, or =true or =false.');
                }
                readOnlyFlag = value !== 'false';
                options.readOnly = readOnlyFlag;
            } else if (key === 'enable-raw-card-tools') {
                throw new Error(RAW_CARD_REMOVED);
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

    if (env.FLW_ENABLE_RAW_CARD_TOOLS !== undefined) {
        throw new Error(RAW_CARD_REMOVED);
    }

    const listedTools = options.tools.map((tool) => tool.trim());
    // Live credentials stop here until live mode is approved; the error lists the unmet conditions.
    assertTestCredentials(apiVersion, env, { tools: listedTools, readOnlyFlag });

    // Read-only: explicit flag, then FLW_READ_ONLY. Off by default in test mode;
    // on by default with live keys (only --read-only=false turns it off there).
    if (options.readOnly === undefined) {
        options.readOnly = credentialsAreLive(apiVersion, env) || env.FLW_READ_ONLY === 'true';
    }
    if (options.readOnly) {
        const writes = listedTools.filter((tool) => tool !== 'all' && !isReadOnlyTool(tool));
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
