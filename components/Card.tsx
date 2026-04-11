import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`bg-card border border-border rounded-card p-4 ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  label: string;
  right?: React.ReactNode;
}

export function CardHeader({ label, right }: CardHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-3">
      <div className="text-2xs uppercase tracking-wider font-medium text-text-secondary">
        {label}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
