export interface TmpfsOptions {
  /**
   * Allow executing files from the mount. Docker mounts every `--tmpfs` with
   * `nosuid,nodev,noexec` by default, which silently breaks toolchains that
   * compile a binary and then run it (Go's `go test` is the main one).
   */
  exec?: boolean;
}

export function tmpfs(
  path: string,
  bytes: number,
  options: TmpfsOptions = {},
): string {
  const flags = ["rw", options.exec === false ? "noexec" : "exec", "nosuid", "nodev"];
  return `${path}:${flags.join(",")},size=${bytes},mode=1777`;
}
