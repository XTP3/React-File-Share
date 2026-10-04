import { useId } from "react";

type LogoProps = {
  size?: number | string;
  color?: string;
  className?: string;
};

/** The supplied X mark, rendered without animation. */
export function Logo({
  size = 64,
  color = "currentColor",
  className,
}: LogoProps) {
  const titleId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby={titleId}
      className={className}
    >
      <title id={titleId}>X</title>
      <path d="M 22 10 L 36 10 L 78 90 L 64 90 Z" fill={color} />
      <path d="M 66 10 L 72 10 L 30 90 L 24 90 Z" fill={color} />
      <path d="M 74 10 L 80 10 L 38 90 L 32 90 Z" fill={color} />
    </svg>
  );
}
