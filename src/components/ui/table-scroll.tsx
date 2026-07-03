import { cn } from "@/lib/utils";

export function TableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-1 overflow-x-auto px-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0",
        className
      )}
    >
      {children}
    </div>
  );
}
