import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  subtextColor?: "green" | "amber" | "red" | "gray";
}

const subtextColors = {
  green: "text-accent-green",
  amber: "text-accent-amber",
  red: "text-accent-red",
  gray: "text-text-secondary",
};

export function StatCard({ label, value, subtext, subtextColor = "gray" }: StatCardProps) {
  return (
    <Card>
      <div className="text-2xs uppercase tracking-wider font-medium text-text-secondary">
        {label}
      </div>
      <div className="mono text-2xl font-semibold text-text-primary mt-1">{value}</div>
      {subtext && <div className={`text-2xs mt-1 ${subtextColors[subtextColor]}`}>{subtext}</div>}
    </Card>
  );
}
