import { Toggle } from "@/components/ui/toggle";
import { Check, Info } from "@/components/icons/platform-icons";

import type {
    ClassicConfigState,
    EnvRow,
    PortProtocol,
    PortRow,
    VolumeRow,
} from "@/modules/apps/components/configurator/configurator-mapper";

const NETWORK_OPTIONS = ["bridge", "host"] as const;
const PORT_PROTOCOL_OPTIONS = ["TCP", "UDP", "TCP + UDP"] as const;

type ClassicFormViewProps = {
  appIdLabel?: string;
  state: ClassicConfigState;
  onChange: (state: ClassicConfigState) => void;
};

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ClassicFormView({
  appIdLabel,
  state,
  onChange,
}: ClassicFormViewProps) {
  const update = (patch: Partial<ClassicConfigState>) => {
    onChange({ ...state, ...patch });
  };

  return (
    <section className="flex-1 overflow-y-auto px-4 py-3">
      {appIdLabel ? (
        <div className="mb-3 border-b border-glass-border pb-3">
          <button className="cursor-default border-b-2 border-primary pb-1 text-base font-semibold text-primary">
            {appIdLabel}
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        <Field label="Docker Image *">
          <Input
            ariaLabel="Docker Image"
            value={state.dockerImage}
            onChange={(value) => update({ dockerImage: value })}
            placeholder="e.g. nginx:latest"
            success
          />
        </Field>

        <Field label="Title *">
          <Input
            ariaLabel="Title"
            value={state.title}
            onChange={(value) => update({ title: value })}
            placeholder="e.g. Your App Name"
            success
          />
        </Field>

        <Field label="Icon URL">
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-glass-border bg-secondary/30">
              {state.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.iconUrl}
                  alt={`${state.title || "App"} icon`}
                  className="size-full object-cover"
                />
              ) : (
                <span className="text-xs text-muted-foreground">N/A</span>
              )}
            </div>
            <Input
              ariaLabel="Icon URL"
              value={state.iconUrl}
              onChange={(value) => update({ iconUrl: value })}
              placeholder="https://..."
            />
          </div>
        </Field>

        <Field label="Web UI">
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-12">
            <div className="md:col-span-2">
              <Select
                ariaLabel="Web UI protocol"
                value={state.webUi.protocol}
                options={[
                  { value: "http", label: "http://" },
                  { value: "https", label: "https://" },
                ]}
                onChange={(value) =>
                  update({
                    webUi: {
                      ...state.webUi,
                      protocol: value === "https" ? "https" : "http",
                    },
                  })
                }
              />
            </div>
            <div className="md:col-span-5">
              <Input
                ariaLabel="Web UI host"
                value={state.webUi.host}
                onChange={(value) =>
                  update({
                    webUi: {
                      ...state.webUi,
                      host: value,
                    },
                  })
                }
                placeholder="localhost"
              />
            </div>
            <div className="md:col-span-2">
              <Input
                ariaLabel="Web UI port"
                value={state.webUi.port}
                onChange={(value) =>
                  update({
                    webUi: {
                      ...state.webUi,
                      port: value.replace(/[^0-9]/g, ""),
                    },
                  })
                }
                placeholder="8080"
              />
            </div>
            <div className="md:col-span-3">
              <Input
                ariaLabel="Web UI path"
                value={state.webUi.path}
                onChange={(value) =>
                  update({
                    webUi: {
                      ...state.webUi,
                      path: value,
                    },
                  })
                }
                placeholder="/index.html"
              />
            </div>
          </div>
        </Field>

        <Field label="Link">
          <Input
            ariaLabel="Custom link"
            value={state.webUiLink}
            onChange={(value) => update({ webUiLink: value })}
            placeholder="https://myapp.example.com"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Where the Open button sends you. Leave empty to use this server&apos;s
            address. Set it when the app is published through a tunnel or reverse
            proxy.
          </p>
        </Field>

        <Field label="Network">
          <Select
            ariaLabel="Network"
            value={state.network}
            options={NETWORK_OPTIONS.map((option) => ({
              value: option,
              label: option,
            }))}
            onChange={(value) => update({ network: value })}
          />
        </Field>

        <Field
          label="Port"
          withAdd
          onAdd={() =>
            update({
              ports: [
                ...state.ports,
                {
                  id: nextId("port"),
                  host: "",
                  container: "",
                  protocol: "TCP",
                },
              ],
            })
          }
        >
          {state.ports.length === 0 ? (
            <HintText />
          ) : (
            <div className="space-y-1.5">
              {state.ports.map((row) => (
                <PortEditor
                  key={row.id}
                  row={row}
                  onRemove={() =>
                    update({
                      ports: state.ports.filter((item) => item.id !== row.id),
                    })
                  }
                  onChange={(nextRow) =>
                    update({
                      ports: state.ports.map((item) =>
                        item.id === row.id ? nextRow : item,
                      ),
                    })
                  }
                />
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Volumes"
          withAdd
          onAdd={() =>
            update({
              volumes: [
                ...state.volumes,
                {
                  id: nextId("volume"),
                  host: "",
                  container: "",
                },
              ],
            })
          }
        >
          {state.volumes.length === 0 ? (
            <HintText />
          ) : (
            <div className="space-y-1.5">
              {state.volumes.map((row) => (
                <VolumeEditor
                  key={row.id}
                  row={row}
                  onRemove={() =>
                    update({
                      volumes: state.volumes.filter(
                        (item) => item.id !== row.id,
                      ),
                    })
                  }
                  onChange={(nextRow) =>
                    update({
                      volumes: state.volumes.map((item) =>
                        item.id === row.id ? nextRow : item,
                      ),
                    })
                  }
                />
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Environment Variables"
          withAdd
          onAdd={() =>
            update({
              envVars: [
                ...state.envVars,
                {
                  id: nextId("env"),
                  key: "",
                  value: "",
                },
              ],
            })
          }
        >
          {state.envVars.length === 0 ? (
            <HintText />
          ) : (
            <div className="space-y-1.5">
              {state.envVars.map((row) => (
                <EnvEditor
                  key={row.id}
                  row={row}
                  onRemove={() =>
                    update({
                      envVars: state.envVars.filter(
                        (item) => item.id !== row.id,
                      ),
                    })
                  }
                  onChange={(nextRow) =>
                    update({
                      envVars: state.envVars.map((item) =>
                        item.id === row.id ? nextRow : item,
                      ),
                    })
                  }
                />
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Devices"
          withAdd
          onAdd={() => update({ devices: [...state.devices, ""] })}
        >
          <StringListEditor
            values={state.devices}
            placeholder="/dev/ttyUSB0:/dev/ttyUSB0"
            onChange={(values) => update({ devices: values })}
          />
        </Field>

        <Field
          label="Container Command"
          withAdd
          onAdd={() =>
            update({ containerCommands: [...state.containerCommands, ""] })
          }
        >
          <StringListEditor
            values={state.containerCommands}
            placeholder="--config /app/config.yaml"
            onChange={(values) => update({ containerCommands: values })}
          />
        </Field>

        <Field label="Privileges">
          <Toggle
            type="button"
            aria-label="Privileges"
            aria-pressed={state.privileged}
            pressed={state.privileged}
            variant="outline"
            className="h-9 justify-start gap-2 px-3 text-xs"
            onPressedChange={(pressed) => update({ privileged: pressed })}
          >
            <span
              className={`inline-block size-2 rounded-[var(--radius)] ${
                state.privileged ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            />
            {state.privileged ? "Enabled" : "Disabled"}
          </Toggle>
        </Field>

        <Field label="Restart Policy">
          <Input
            ariaLabel="Restart Policy"
            value={state.restartPolicy}
            onChange={(value) => update({ restartPolicy: value })}
            placeholder="always"
          />
        </Field>

        <Field label="Container Capabilities (cap-add)">
          <Input
            ariaLabel="Container Capabilities (cap-add)"
            value={state.capabilities}
            onChange={(value) => update({ capabilities: value })}
            placeholder="NET_ADMIN,SYS_TIME"
          />
        </Field>

        <Field label="Container Hostname">
          <Input
            ariaLabel="Container Hostname"
            value={state.hostname}
            onChange={(value) => update({ hostname: value })}
            placeholder="Hostname of app container"
            success
          />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  withAdd = false,
  onAdd,
}: {
  label: string;
  children: React.ReactNode;
  withAdd?: boolean;
  onAdd?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        {withAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="cursor-pointer rounded-[var(--radius)] border border-glass-border bg-secondary/40 px-2.5 py-0.5 text-2xs font-medium text-foreground transition-colors hover:bg-secondary/60"
          >
            + Add
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Input({
  ariaLabel,
  value,
  onChange,
  placeholder,
  readOnly = false,
  success = false,
}: {
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  success?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`h-9 w-full rounded-lg border bg-secondary/35 px-2.5 pr-8 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none ${
          success
            ? "border-status-green/70 focus:border-status-green"
            : "border-glass-border focus:border-primary/50"
        } ${readOnly ? "opacity-80" : ""}`}
      />
      {success ? (
        <Check className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-status-green" />
      ) : null}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-glass-border bg-secondary/35 px-2.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function HintText() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5" />
      Click &quot;+&quot; to add one.
    </p>
  );
}

function PortEditor({
  row,
  onRemove,
  onChange,
}: {
  row: PortRow;
  onRemove: () => void;
  onChange: (row: PortRow) => void;
}) {
  return (
    <div className="rounded-lg border border-glass-border bg-secondary/20 p-1.5">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer text-2xs text-muted-foreground hover:text-status-red"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
        <Input
          value={row.host}
          onChange={(value) =>
            onChange({ ...row, host: value.replace(/[^0-9]/g, "") })
          }
          placeholder="Host"
        />
        <Input
          value={row.container}
          onChange={(value) =>
            onChange({ ...row, container: value.replace(/[^0-9]/g, "") })
          }
          placeholder="Container"
        />
        <Select
          ariaLabel="Protocol"
          value={row.protocol}
          options={PORT_PROTOCOL_OPTIONS.map((option) => ({
            value: option,
            label: option,
          }))}
          onChange={(value) =>
            onChange({ ...row, protocol: value as PortProtocol })
          }
        />
      </div>
    </div>
  );
}

function VolumeEditor({
  row,
  onRemove,
  onChange,
}: {
  row: VolumeRow;
  onRemove: () => void;
  onChange: (row: VolumeRow) => void;
}) {
  return (
    <div className="rounded-lg border border-glass-border bg-secondary/20 p-1.5">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer text-2xs text-muted-foreground hover:text-status-red"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <Input
          value={row.host}
          onChange={(value) => onChange({ ...row, host: value })}
          placeholder="Host"
        />
        <Input
          value={row.container}
          onChange={(value) => onChange({ ...row, container: value })}
          placeholder="Container"
        />
      </div>
    </div>
  );
}

function EnvEditor({
  row,
  onRemove,
  onChange,
}: {
  row: EnvRow;
  onRemove: () => void;
  onChange: (row: EnvRow) => void;
}) {
  return (
    <div className="rounded-lg border border-glass-border bg-secondary/20 p-1.5">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer text-2xs text-muted-foreground hover:text-status-red"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <Input
          value={row.key}
          onChange={(value) => onChange({ ...row, key: value })}
          placeholder="KEY"
        />
        <Input
          value={row.value}
          onChange={(value) => onChange({ ...row, value })}
          placeholder="VALUE"
        />
      </div>
    </div>
  );
}

function StringListEditor({
  values,
  placeholder,
  onChange,
}: {
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  if (values.length === 0) {
    return <HintText />;
  }

  return (
    <div className="space-y-1.5">
      {values.map((value, index) => (
        <div
          key={`${index}-${value}`}
          className="rounded-lg border border-glass-border bg-secondary/20 p-1.5"
        >
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              onClick={() =>
                onChange(
                  values.filter((_, currentIndex) => currentIndex !== index),
                )
              }
              className="cursor-pointer text-2xs text-muted-foreground hover:text-status-red"
            >
              Remove
            </button>
          </div>
          <Input
            value={value}
            onChange={(nextValue) =>
              onChange(
                values.map((entry, currentIndex) =>
                  currentIndex === index ? nextValue : entry,
                ),
              )
            }
            placeholder={placeholder}
          />
        </div>
      ))}
    </div>
  );
}
