"use client";

import { Maximize2, Minimize2, Minus, X } from "@/components/icons/platform-icons";
import { ChevronLeftRegular } from "@fluentui/react-icons";
import { OverlayActivityContext } from "@/components/ui/overlay-activity";
import { MobileWindowPageContext, type MobileWindowPage } from "@/components/ui/mobile-window-page";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

type WindowProps = {
  title: string;
  mobile?: boolean;
  inactive?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  onMinimize?: () => void;
  defaultWidth?: number;
  defaultHeight?: number;
  zIndex?: number;
  dockPosition?: "bottom" | "left" | "right";
  onFocus?: () => void;
  isClosing?: boolean;
  isMinimized?: boolean;
  animationsEnabled?: boolean;
};

const BOTTOM_DOCK_CLEARANCE = 88;
const SIDE_DOCK_CLEARANCE = 80;

export function Window({
  title,
  mobile = false,
  inactive = false,
  icon,
  children,
  onClose,
  onMinimize,
  defaultWidth = 900,
  defaultHeight = 580,
  zIndex = 100,
  dockPosition = "bottom",
  onFocus,
  isClosing = false,
  isMinimized = false,
  animationsEnabled = true,
}: WindowProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [mobilePage, setMobilePage] = useState<MobileWindowPage | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const preMaxState = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const backSwipe = useRef<{ x: number; y: number } | null>(null);

  // Center on mount
  useEffect(() => {
    if (!mobile && position.x === -1) {
      setPosition({
        x: Math.max(40, (window.innerWidth - size.w) / 2),
        y: Math.max(50, (window.innerHeight - size.h) / 2 - 20),
      });
    }
  }, [mobile, position.x, size.w, size.h]);

  useEffect(() => {
    if (!animationsEnabled) {
      setIsVisible(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [animationsEnabled]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      onFocus?.();
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [isMaximized, position, onFocus],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      e.stopPropagation();
      onFocus?.();
      setIsResizing(true);
      dragOffset.current = {
        x: e.clientX,
        y: e.clientY,
      };
    },
    [isMaximized, onFocus],
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      }
      if (isResizing) {
        const dx = e.clientX - dragOffset.current.x;
        const dy = e.clientY - dragOffset.current.y;
        setSize((prev) => ({
          w: Math.max(500, prev.w + dx),
          h: Math.max(350, prev.h + dy),
        }));
        dragOffset.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing]);

  function toggleMaximize() {
    if (isMaximized) {
      setPosition({ x: preMaxState.current.x, y: preMaxState.current.y });
      setSize({ w: preMaxState.current.w, h: preMaxState.current.h });
      setIsMaximized(false);
    } else {
      preMaxState.current = {
        x: position.x,
        y: position.y,
        w: size.w,
        h: size.h,
      };
      setIsMaximized(true);
    }
  }

  const maximizedStyle =
    dockPosition === "left"
      ? {
          top: 0,
          right: 0,
          bottom: 0,
          left: SIDE_DOCK_CLEARANCE,
          zIndex,
          width: "auto",
          height: "auto",
        }
      : dockPosition === "right"
        ? {
            top: 0,
            right: SIDE_DOCK_CLEARANCE,
            bottom: 0,
            left: 0,
            zIndex,
            width: "auto",
            height: "auto",
          }
        : {
            top: 0,
            right: 0,
            bottom: BOTTOM_DOCK_CLEARANCE,
            left: 0,
            zIndex,
            width: "auto",
            height: "auto",
          };

  const hidden = inactive || (isMinimized && !mobile);
  const back = mobilePage?.onBack ?? onClose;

  return (
    <div
      ref={windowRef}
      role={mobile ? "region" : undefined}
      aria-label={mobile ? title : undefined}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={mobile
        ? "mobile-window mobile-window-opening absolute z-[110] flex min-h-0 flex-col overflow-hidden bg-[var(--mobile-canvas)]"
        : `absolute flex flex-col overflow-hidden border border-glass-border ${
            isMaximized
              ? "rounded-[calc(var(--radius)+0.5rem)] shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
              : "rounded-[calc(var(--radius)+0.375rem)] shadow-2xl shadow-black/50"
          } ${animationsEnabled ? "transition-[opacity,transform] duration-200 ease-out" : ""} ${
            !animationsEnabled || (isVisible && !isClosing)
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-2"
          }`}
      style={hidden ? { display: "none" } : mobile ? undefined : isMaximized ? maximizedStyle : {
        left: position.x, top: position.y, width: size.w, height: size.h, zIndex,
      }}
      onMouseDown={mobile ? undefined : () => onFocus?.()}
    >
      {mobile ? (
        <header
          className="mobile-window-header flex shrink-0 items-center gap-1 border-b border-[var(--mobile-divider)]"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            backSwipe.current = event.touches.length === 1 && touch.clientX >= 24 && !(event.target as Element).closest("button")
              ? { x: touch.clientX, y: touch.clientY }
              : null;
          }}
          onTouchEnd={(event) => {
            const start = backSwipe.current;
            backSwipe.current = null;
            if (!start || event.touches.length || event.changedTouches.length !== 1) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (dx >= 80 && dx > Math.abs(dy) * 1.5) back();
          }}
          onTouchCancel={() => { backSwipe.current = null; }}
        >
          <button type="button" onClick={back} aria-label="Go back" className="mobile-tool">
            <ChevronLeftRegular className="size-5" aria-hidden="true" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.025em]">{mobilePage?.title ?? title}</h1>
        </header>
      ) : (
      <div
        className="flex items-center justify-between h-11 px-4 bg-popover/80 backdrop-blur-2xl border-b border-glass-border select-none shrink-0"
        onMouseDown={handleMouseDown}
        style={{
          cursor: isDragging ? "grabbing" : isMaximized ? "default" : "grab",
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClose}
                  className="group size-3 rounded-[var(--radius)] bg-[#ff5f57] hover:brightness-110 transition-all flex items-center justify-center cursor-pointer"
                  aria-label="Close window"
                >
                  <X className="size-2 text-[#4a0002] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>Close</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onMinimize}
                  className="group size-3 rounded-[var(--radius)] bg-[#febc2e] hover:brightness-110 transition-all flex items-center justify-center cursor-pointer"
                  aria-label="Minimize window"
                >
                  <Minus className="size-2 text-[#5f4a00] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>Minimize</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleMaximize}
                  className="group size-3 rounded-[var(--radius)] bg-[#28c840] hover:brightness-110 transition-all flex items-center justify-center cursor-pointer"
                  aria-label={isMaximized ? "Restore window" : "Maximize window"}
                >
                  {isMaximized ? (
                    <Minimize2 className="size-2 text-[#004a00] opacity-0 group-hover:opacity-100 transition-opacity" />
                  ) : (
                    <Maximize2 className="size-2 text-[#004a00] opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {isMaximized ? "Restore" : "Maximize"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
          {icon}
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>

        <div className="w-16" />
      </div>

      )}

      {/* Window content */}
      <div className={mobile ? "mobile-window-content min-h-0 flex-1 overflow-hidden" : "flex-1 overflow-hidden bg-card/90 backdrop-blur-2xl"}>
        <OverlayActivityContext.Provider value={!hidden && !isClosing}>
          <MobileWindowPageContext.Provider value={mobile ? setMobilePage : null}>
            {children}
          </MobileWindowPageContext.Provider>
        </OverlayActivityContext.Provider>
      </div>

      {/* Resize handle */}
      {!mobile && !isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
}
