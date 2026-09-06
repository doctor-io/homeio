"use client";

import { Maximize2, Minimize2, Minus, X } from "@/components/icons/platform-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

type WindowProps = {
  title: string;
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

/** Below this width there is no room for a window to float; it fills the screen. */
const COMPACT_VIEWPORT_WIDTH = 640;

/** Never shrink a window past the point where its own chrome stops working. */
const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 320;

function viewportMargin(viewportWidth: number) {
  return viewportWidth < COMPACT_VIEWPORT_WIDTH ? 8 : 40;
}

/**
 * A window asked for 900x580 and got it whatever the screen measured, so on a
 * phone two thirds of Settings sat off the right edge. Sizes are requests now,
 * clamped to what the display can actually show.
 *
 * Only ever shrinks, so a window the user has resized down stays where they
 * put it.
 */
function fitToViewport(width: number, height: number) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportMargin(viewportWidth);
  const topInset = viewportWidth < COMPACT_VIEWPORT_WIDTH ? 56 : 50;

  return {
    w: Math.max(MIN_WINDOW_WIDTH, Math.min(width, viewportWidth - margin * 2)),
    h: Math.max(
      MIN_WINDOW_HEIGHT,
      Math.min(height, viewportHeight - topInset - BOTTOM_DOCK_CLEARANCE),
    ),
  };
}

export function Window({
  title,
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
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const preMaxState = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Fit to the display before centring, and again whenever it changes — a
  // phone rotating is the same problem as a window opened too large.
  useEffect(() => {
    function clampToViewport() {
      setSize((previous) => {
        const fitted = fitToViewport(previous.w, previous.h);
        return fitted.w === previous.w && fitted.h === previous.h
          ? previous
          : fitted;
      });
    }

    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  // Center on mount
  useEffect(() => {
    if (position.x === -1) {
      const margin = viewportMargin(window.innerWidth);
      setPosition({
        x: Math.max(margin, (window.innerWidth - size.w) / 2),
        y: Math.max(50, (window.innerHeight - size.h) / 2 - 20),
      });
    }
  }, [position.x, size.w, size.h]);

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

  if (isMinimized) return null;

  return (
    <div
      ref={windowRef}
      className={`absolute flex flex-col overflow-hidden border border-glass-border ${
        isMaximized
          ? "rounded-[calc(var(--radius)+0.5rem)] shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
          : "rounded-[calc(var(--radius)+0.375rem)] shadow-2xl shadow-black/50"
      } ${
        animationsEnabled
          ? "transition-[opacity,transform] duration-200 ease-out"
          : ""
      } ${
        !animationsEnabled || (isVisible && !isClosing)
          ? "opacity-100 scale-100 translate-y-0"
          : "opacity-0 scale-95 translate-y-2"
      }`}
      style={
        isMaximized
          ? maximizedStyle
          : {
              left: position.x,
              top: position.y,
              width: size.w,
              height: size.h,
              zIndex,
            }
      }
      onMouseDown={() => onFocus?.()}
    >
      {/* Title bar */}
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

      {/* Window content */}
      <div className="flex-1 overflow-hidden bg-card/90 backdrop-blur-2xl">
        {children}
      </div>

      {/* Resize handle */}
      {!isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
}
