interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "amber" | "red" | "gray";
}

const styles = {
  green: "bg-accent-green/10 text-accent-green",
  amber: "bg-accent-amber/10 text-accent-amber",
  red: "bg-accent-red/10 text-accent-red",
  gray: "bg-hover text-text-secondary",
};

export function Badge({ children, variant = "gray" }: BadgeProps) {
  return (
    <span className={`text-2xs px-2 py-0.5 rounded-badge font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}
