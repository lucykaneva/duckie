"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export function Primitives() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="mt-14">
        <h2 className="text-label">Button</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="ink">Ink</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Saving</Button>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Card</h2>
        <Card className="mt-4">
          <p className="text-section">A white card</p>
          <p className="mt-2 text-body">14px radius, 1px border, 24px padding, no resting shadow.</p>
        </Card>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Badge</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>Test</Badge>
          <Badge dotClassName="bg-state-grey-fg">Not yet</Badge>
          <Badge dotClassName="bg-state-green-fg">Owned</Badge>
          <Badge dotClassName="bg-state-yellow-fg">Assisted</Badge>
          <Badge dotClassName="bg-state-red-fg">Explained to</Badge>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Input</h2>
        <div className="mt-4 flex flex-col gap-6">
          <Input label="Course name" hint="What you teach the duck." placeholder="Algorithms" />
          <Input label="Course name" error="Give the course a name." defaultValue="Biology" />
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Dialog</h2>
        <Button className="mt-4" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Dialog open={open} title="New course" onClose={() => setOpen(false)}>
          <p className="mt-3 text-body">White, 14px radius, shadow. Escape or the backdrop closes it.</p>
          <div className="mt-5 flex justify-end">
            <Button onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Dialog>
      </section>

      <section className="mt-14">
        <h2 className="text-label">Empty and error</h2>
        <div className="mt-4 flex flex-col gap-4">
          <EmptyState
            message="No course here. Quiet. duckie like quiet."
            action={<Button>New course</Button>}
          />
          <ErrorState message="Couldn't load courses." action={<Button variant="ink">Try again</Button>} />
          <div className="flex items-center gap-3">
            <Spinner className="size-6 text-ink" />
            <p className="text-small text-ink-muted">Spinner</p>
          </div>
        </div>
      </section>
    </>
  );
}
