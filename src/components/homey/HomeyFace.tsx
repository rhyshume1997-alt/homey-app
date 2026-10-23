"use client";

import { useId, useState, type CSSProperties } from "react";
import type { Expression } from "./types";
import styles from "./homey.module.css";

export type HomeyFaceProps = {
  expression: Expression;
  /** Rendered width and height in px. Designed for 24 to 160. */
  size?: number;
  /** Idle life (blink, bob, glance, pop). Always off under prefers-reduced-motion. */
  animated?: boolean;
  /** Accessible name. When omitted the face is decorative (aria-hidden). */
  title?: string;
  /** Eyes look sideways. An ancestor with data-glance="left|right" works too. */
  glance?: "left" | "right";
};

/** Stable per-instance blink timing from the React id, so server and client markup match. */
function blinkTiming(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const period = 3.5 + (h % 26) / 10; // 3.5s to 6s
  const delay = ((h >>> 5) % 30) / 10; // 0s to 3s
  return { period: `${period.toFixed(1)}s`, delay: `${delay.toFixed(1)}s` };
}

const NAVY = "#13233a";
const s = styles;

/** Homey, the light-blue glass house. Pure SVG; every shape is a layer faded and scaled by CSS. */
export function HomeyFace({ expression, size = 56, animated = true, title, glance }: HomeyFaceProps) {
  const rid = useId();
  const id = rid.replace(/[^a-zA-Z0-9]/g, "");
  const [shown, setShown] = useState(expression);
  const [pop, setPop] = useState(0);
  if (shown !== expression) {
    // Alternate between two identical keyframes so the pop restarts on every change.
    setShown(expression);
    setPop((p) => (p === 1 ? 2 : 1));
  }
  const t = blinkTiming(id);
  const cls = [s.root, animated ? "" : s.static, pop === 1 ? s.popA : pop === 2 ? s.popB : ""]
    .filter(Boolean)
    .join(" ");
  const labelled = Boolean(title);

  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      data-expression={expression}
      data-glance={glance}
      data-animated={animated ? "true" : "false"}
      style={{ "--homey-blink": t.period, "--homey-blink-delay": t.delay } as CSSProperties}
      {...(labelled ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      focusable="false"
    >
      {labelled && <title>{title}</title>}
      <defs>
        <linearGradient id={`hb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fd4f5" />
          <stop offset="1" stopColor="#5fa8d8" />
        </linearGradient>
      </defs>
      <g className={s.sparkles} fill="#fff">
        <path className={s.spark} d="M12 22q1 5 5 5q-4 0-5 5q-1-5-5-5q4 0 5-5z" />
        <path className={s.spark} d="M88 8q.8 4 4 4q-3.2 0-4 4q-.8-4-4-4q3.2 0 4-4z" />
        <path className={s.spark} d="M93 30q.6 3 3 3q-2.4 0-3 3q-.6-3-3-3q2.4 0 3-3z" />
      </g>
      <g className={s.bob}>
        <g className={s.pop}>
          <g className={s.wobble}>
            <path
              d="M50 9L88 41V84Q88 90 82 90H18Q12 90 12 84V41Z"
              fill={`url(#hb${id})`}
              stroke="rgba(255,255,255,.45)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path d="M22 41L46 21" stroke="rgba(255,255,255,.6)" strokeWidth="3" strokeLinecap="round" />
            <g fill="#e58fa8" opacity=".55">
              <circle cx="30" cy="69" r="4.5" />
              <circle cx="70" cy="69" r="4.5" />
            </g>
            <g fill="none" stroke={NAVY} strokeWidth="2.6" strokeLinecap="round">
              <path className={`${s.l} ${s.browWorry}`} d="M33 49L45 46M55 46L67 49" />
              <path className={`${s.l} ${s.browArch}`} d="M33 47Q40 41 47 47M53 47Q60 41 67 47" />
            </g>
            <g className={s.glance}>
              <g className={s.blink}>
                <g className={`${s.l} ${s.dots}`}>
                  <circle cx="40" cy="59" r="5.5" fill={NAVY} />
                  <circle cx="60" cy="59" r="5.5" fill={NAVY} />
                  <circle cx="41.8" cy="57" r="1.8" fill="#fff" />
                  <circle cx="61.8" cy="57" r="1.8" fill="#fff" />
                  <g className={`${s.l} ${s.glint2}`} fill="#fff">
                    <circle cx="38" cy="61.5" r="1" />
                    <circle cx="58" cy="61.5" r="1" />
                  </g>
                </g>
                <g className={`${s.l} ${s.wide}`}>
                  <circle cx="40" cy="58" r="7.5" fill="#fff" />
                  <circle cx="60" cy="58" r="7.5" fill="#fff" />
                  <circle cx="40" cy="58" r="4" fill={NAVY} />
                  <circle cx="60" cy="58" r="4" fill={NAVY} />
                  <circle cx="41.4" cy="56.6" r="1.3" fill="#fff" />
                  <circle cx="61.4" cy="56.6" r="1.3" fill="#fff" />
                </g>
              </g>
              <g fill="none" stroke={NAVY} strokeWidth="3" strokeLinecap="round">
                <path className={`${s.l} ${s.arcs}`} d="M34 60Q40 53 46 60M54 60Q60 53 66 60" />
                <path className={`${s.l} ${s.closed}`} d="M34 58Q40 63 46 58M54 58Q60 63 66 58" />
              </g>
            </g>
            <g fill="none" stroke={NAVY} strokeWidth="2.8" strokeLinecap="round">
              <path className={`${s.l} ${s.smile}`} d="M44 69Q50 75 56 69" />
              <path className={`${s.l} ${s.wavy}`} d="M42 72Q44 69 46 72T50 72T54 72T58 72" />
            </g>
            <g className={`${s.l} ${s.grin}`}>
              <path d="M42.5 67H57.5Q57 77 50 77Q43 77 42.5 67Z" fill={NAVY} />
              <ellipse cx="50" cy="74.5" rx="3.6" ry="2" fill="#f08aa0" />
            </g>
            <ellipse className={`${s.l} ${s.oh}`} cx="50" cy="72" rx="4" ry="5.5" fill={NAVY} />
          </g>
        </g>
      </g>
    </svg>
  );
}
