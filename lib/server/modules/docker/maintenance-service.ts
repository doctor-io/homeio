import "server-only";

import { logServerAction } from "@/lib/server/logging/logger";
import * as dockerPlatform from "@/lib/server/platform/docker";


export type DockerPruneResult = {
  command: "images" | "volumes";
  output: string;
};

async function runDockerPrune(
  command: DockerPruneResult["command"],
  args: string[],
) {
  const { stdout, stderr } = await dockerPlatform.prune(args);
  const output = [stdout, stderr].filter((value) => value.trim().length > 0).join("\n").trim();

  logServerAction({
    layer: "service",
    action: `docker.prune.${command}`,
    status: "success",
    message: `Pruned unused Docker ${command}`,
    meta: {
      args,
      output,
    },
  });

  return {
    command,
    output,
  } satisfies DockerPruneResult;
}

export async function pruneDockerImages() {
  return runDockerPrune("images", ["image", "prune", "-af"]);
}

export async function pruneDockerVolumes() {
  return runDockerPrune("volumes", ["volume", "prune", "-f"]);
}
