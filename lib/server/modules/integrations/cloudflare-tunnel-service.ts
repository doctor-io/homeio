import "server-only";

import { request } from "node:http";
import { serverEnv } from "@/lib/server/env";
import { logServerAction } from "@/lib/server/logging/logger";
import type { CloudflareTunnelStatus } from "@/lib/shared/contracts/cloudflare-tunnel";

/**
 * cloudflared runs as a container rather than a host package: Homeio already
 * has the Docker socket, and `tunnel run --token` is exactly what Cloudflare's
 * dashboard hands out. No distro-specific install, no /dev/net/tun.
 */
const CONTAINER_NAME = "homeio-cloudflared";
const IMAGE = "cloudflare/cloudflared:latest";

type DockerResponse = { statusCode: number; body: string };

function dockerCall(
  path: string,
  options?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<DockerResponse> {
  const payload = options?.body === undefined ? null : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: serverEnv.DOCKER_SOCKET_PATH,
        path,
        method: options?.method ?? "GET",
        headers: {
          Host: "docker",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
      },
    );

    req.setTimeout(options?.timeoutMs ?? 120_000, () => {
      req.destroy(new Error("Docker API request timed out"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function failed(response: DockerResponse) {
  return response.statusCode >= 400;
}

function toError(action: string, response: DockerResponse) {
  return new Error(`${action} failed (${response.statusCode}): ${response.body.slice(0, 300)}`);
}

export async function getCloudflareTunnelStatus(): Promise<CloudflareTunnelStatus> {
  try {
    const response = await dockerCall(`/containers/${CONTAINER_NAME}/json`, {
      timeoutMs: 10_000,
    });

    if (response.statusCode === 404) {
      return { installed: false, running: false, state: null, error: null };
    }

    if (failed(response)) {
      return {
        installed: false,
        running: false,
        state: null,
        error: `Docker API returned ${response.statusCode}`,
      };
    }

    const parsed = JSON.parse(response.body) as {
      State?: { Status?: string; Running?: boolean; Error?: string };
    };

    return {
      installed: true,
      running: Boolean(parsed.State?.Running),
      state: parsed.State?.Status ?? null,
      error: parsed.State?.Error || null,
    };
  } catch (error) {
    return {
      installed: false,
      running: false,
      state: null,
      error: error instanceof Error ? error.message : "Could not reach the Docker daemon",
    };
  }
}

async function removeExistingContainer() {
  const response = await dockerCall(`/containers/${CONTAINER_NAME}?force=true&v=true`, {
    method: "DELETE",
    timeoutMs: 30_000,
  });

  if (response.statusCode !== 404 && failed(response)) {
    throw toError("Removing the previous cloudflared container", response);
  }
}

async function pullImage() {
  const response = await dockerCall(
    `/images/create?fromImage=${encodeURIComponent(IMAGE)}`,
    { method: "POST", timeoutMs: 300_000 },
  );

  if (failed(response)) {
    throw toError("Pulling the cloudflared image", response);
  }
}

/**
 * (Re)create the connector with the operator's token and start it.
 * Recreating is deliberate: the token is baked into the container's command,
 * so a new token needs a new container.
 */
export async function activateCloudflareTunnel(token: string): Promise<CloudflareTunnelStatus> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("A connector token is required to activate the tunnel");
  }

  await pullImage();
  await removeExistingContainer();

  const created = await dockerCall(`/containers/create?name=${CONTAINER_NAME}`, {
    method: "POST",
    body: {
      Image: IMAGE,
      Cmd: ["tunnel", "--no-autoupdate", "run", "--token", trimmed],
      HostConfig: {
        NetworkMode: "host",
        RestartPolicy: { Name: "unless-stopped" },
      },
    },
    timeoutMs: 60_000,
  });

  if (failed(created)) {
    throw toError("Creating the cloudflared container", created);
  }

  const started = await dockerCall(`/containers/${CONTAINER_NAME}/start`, {
    method: "POST",
    timeoutMs: 60_000,
  });

  if (failed(started)) {
    throw toError("Starting the cloudflared container", started);
  }

  logServerAction({
    level: "info",
    layer: "service",
    action: "cloudflare-tunnel.activate",
    status: "success",
    message: "cloudflared connector started",
  });

  return getCloudflareTunnelStatus();
}

export async function deactivateCloudflareTunnel(): Promise<CloudflareTunnelStatus> {
  await removeExistingContainer();
  return getCloudflareTunnelStatus();
}
