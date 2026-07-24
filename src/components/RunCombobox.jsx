import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function runLabel(run) {
  return run?.label || run?.name || run?.relativePath || "Unnamed run";
}

function runValue(run) {
  return [
    runLabel(run),
    run?.model,
    run?.mode,
    run?.quantization,
    run?.relativePath,
  ]
    .filter(Boolean)
    .join(" ");
}

export function RunCombobox({
  runs = [],
  selectedId = null,
  onSelect = () => {},
}) {
  const [open, setOpen] = useState(false);
  const selected = runs.find((run) => run?.id === selectedId);
  const disabled = runs.length === 0;

  return (
    <div className="grid min-w-0 gap-1">
      <span className="trace-dropdown-caption">Run</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="trace-selector-button"
            variant="outline"
            role="combobox"
            aria-label="Select run"
            aria-expanded={open}
            disabled={disabled}
            className="run-combobox-trigger w-full max-w-[28rem] justify-between px-3 font-mono text-xs shadow-none"
          >
            <span
              id="trace-selector-label"
              className="min-w-0 truncate text-left"
            >
              {selected
                ? runLabel(selected)
                : disabled
                  ? "Waiting for registry"
                  : "Choose a run"}
            </span>
            <ChevronsUpDown
              className="ml-2 size-3.5 shrink-0 text-cyan-300 opacity-80"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id="trace-menu"
          align="start"
          sideOffset={6}
          className="run-combobox-menu w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        >
          <Command>
            <CommandInput
              id="trace-search"
              placeholder="Search model, mode, or path…"
              className="run-combobox-search"
              wrapperClassName="run-combobox-search-shell"
            />
            <CommandList id="trace-track">
              <CommandEmpty>No runs match this search.</CommandEmpty>
              <CommandGroup heading={`${runs.length} available runs`}>
                {runs.map((run) => (
                  <CommandItem
                    key={run.id}
                    value={runValue(run)}
                    onSelect={() => {
                      onSelect(run.id);
                      setOpen(false);
                    }}
                    className="font-mono"
                  >
                    <Check
                      className={cn(
                        "size-3.5",
                        run.id === selectedId ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">{runLabel(run)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
