"use client";

import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { Plus } from "lucide-react";
import { z } from "zod";

import { ValidatedField } from "@/components/form/validated-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Hospital } from "./hospital";

const hospitalNameSchema = z.string().trim().min(1, "Enter the hospital name");
const hospitalTypeSchema = z.string().trim().min(1, "Enter the hospital type");

const ADD_HOSPITAL_VALUE = "__add-hospital";

function AddHospitalDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, type: string) => void;
}) {
  const form = useForm({
    defaultValues: { name: "", hospitalType: "" },
    // Always run full submit validation: without this, TanStack skips
    // validateAllFields on attempt #1 when a coinciding blur already
    // invalidated the form, so only the blurred field shows an error.
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      onAdd(value.name, value.hospitalType);
      form.reset();
      onOpenChange(false);
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add hospital</DialogTitle>
          <DialogDescription>Register another hospital in this workspace.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <ValidatedField form={form} name="name" label="Hospital name" schema={hospitalNameSchema}>
            {({ input }) => (
              <Input {...input} placeholder="Riverside General Hospital" className="bg-ink-raised" />
            )}
          </ValidatedField>
          <ValidatedField form={form} name="hospitalType" label="Hospital type" schema={hospitalTypeSchema}>
            {({ input }) => (
              <Input {...input} placeholder="General Acute Care Hospital" className="bg-ink-raised" />
            )}
          </ValidatedField>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">Add hospital</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HospitalSwitcher({
  hospitals,
  currentId,
  onSelect,
  onAdd,
}: {
  hospitals: Hospital[];
  currentId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string, type: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const handleValueChange = (value: string | null) => {
    if (!value) return;
    if (value === ADD_HOSPITAL_VALUE) {
      setDialogOpen(true);
      return;
    }
    onSelect(value);
  };
  return (
    <div>
      <Select value={currentId} onValueChange={handleValueChange}>
        <SelectTrigger aria-label="Select hospital" className="w-full bg-ink-raised hover:bg-bark-raised/40">
          <SelectValue>{(value: string | null) => hospitals.find((hospital) => hospital.id === value)?.name ?? "Select hospital"}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-ink-raised">
          {hospitals.map((hospital) => (
            <SelectItem key={hospital.id} value={hospital.id}>
              {hospital.name}
            </SelectItem>
          ))}
          <SelectSeparator className="bg-moss/40" />
          <SelectItem value={ADD_HOSPITAL_VALUE}>
            <Plus />
            Add hospital
          </SelectItem>
        </SelectContent>
      </Select>
      <AddHospitalDialog open={dialogOpen} onOpenChange={setDialogOpen} onAdd={onAdd} />
    </div>
  );
}
