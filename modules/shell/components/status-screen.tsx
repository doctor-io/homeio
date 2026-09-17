"use client";

import Image from "next/image";
import { type ReactNode } from "react";
import { FullScreenShell } from "./full-screen-shell";

type StatusScreenProps = {
  title: string;
  body: string;
  action?: ReactNode;
  /** Shown under the action: detail a waiting person may want, not a control. */
  details?: ReactNode;
  failed?: boolean;
};

export function StatusScreen({
  title,
  body,
  action,
  details,
  failed = false,
}: StatusScreenProps) {
  return (
    <FullScreenShell
      showClock={false}
      center={
        <div className={details ? "w-full max-w-xl text-center" : "w-full max-w-md text-center"}>
          <div className="mx-auto mb-5 flex w-fit flex-col items-center">
            <div
              className={`system-hero-surface flex size-24 items-center justify-center ${
                failed ? "border-status-red/35 bg-status-red/10" : "animate-homeio-breathe-glow"
              }`}
            >
              <Image
                src="/icon.png"
                alt="Homeio"
                width={64}
                height={64}
                className={`relative z-10 size-[3.65rem] blur-[0.15px] ${failed ? "" : "animate-homeio-breathe"}`}
              />
            </div>
            <div className="system-pill-surface mt-2.5 px-3 py-1 text-3xs tracking-[0.24em] text-foreground/58 uppercase">
              {failed ? "Error" : "Home server"}
            </div>
          </div>

          <p className="text-2xl font-medium tracking-[-0.03em] text-foreground">
            {title}
          </p>
          <p className="mb-5 mt-1 text-sm leading-6 text-muted-foreground/78">
            {body}
          </p>
          {action}
          {details}
        </div>
      }
    />
  );
}
