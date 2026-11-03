"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SessionHospital } from "@/lib/auth/session-view";

export function HospitalSwitcher({
  hospitals,
  currentId,
  onSelect,
}: {
  hospitals: SessionHospital[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Select value={currentId} onValueChange={(value) => value && onSelect(value)}>
      <SelectTrigger aria-label="Select hospital" className="w-full bg-ink-raised hover:bg-bark-raised/40">
        <SelectValue>
          {(value: string | null) =>
            hospitals.find((hospital) => hospital.id === value)?.name ?? "Select hospital"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-ink-raised">
        {hospitals.map((hospital) => (
          <SelectItem key={hospital.id} value={hospital.id}>
            {hospital.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
