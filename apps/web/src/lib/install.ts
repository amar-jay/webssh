/** Matches release.json. The installer only accepts an explicit version. */
export const cliVersion = "0.1.0";

export const installCommand = `curl -fsSL https://raw.githubusercontent.com/amar-jay/webssh/v${cliVersion}/scripts/install.sh | sh -s -- ${cliVersion}`;
