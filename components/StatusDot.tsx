interface StatusDotProps {
  status: "green" | "amber" | "red" | "gray";
  size?: number;
}

const colors = {
  green: "bg-accent-green",
  amber: "bg-accent-amber",
  red: "bg-accent-red",
  gray: "bg-text-muted",
};

export function StatusDot({ status, size = 8 }: StatusDotProps) {
  return (
    <div
      className={`rounded-full shrink-0 ${colors[status]}`}
      style={{ width: size, height: size }}
    />
  );
}
