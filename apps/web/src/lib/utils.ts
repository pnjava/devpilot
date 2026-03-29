import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function healthColor(score: number): string {
  if (score >= 70) return 'text-health-green';
  if (score >= 40) return 'text-health-amber';
  return 'text-health-red';
}

export function healthBg(score: number): string {
  if (score >= 70) return 'bg-health-green';
  if (score >= 40) return 'bg-health-amber';
  return 'bg-health-red';
}

export function healthLabel(score: number): string {
  if (score >= 70) return 'Healthy';
  if (score >= 40) return 'At Risk';
  return 'Critical';
}
