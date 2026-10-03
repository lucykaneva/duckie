import type { ReactNode } from "react";
import { Card } from "./Card";

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="text-body">{message}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Card>
  );
}
