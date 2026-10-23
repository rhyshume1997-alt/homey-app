import { requireSession } from "@/server/auth/session";
import { loadCalendarItems } from "@/server/data/calendar";
import { listRoomOptions } from "@/server/data/household-events";
import { londonToday, addDays } from "@/components/bins/group";
import { Agenda } from "@/components/calendar/Agenda";
import { EventForm } from "@/components/calendar/EventForm";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { monthGrid, parseDay, parseMonth } from "@/components/calendar/grid";
import { addEventAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const today = londonToday(new Date());
  const selected = parseDay(sp.d) ?? today;
  const month = parseMonth(sp.m, parseDay(sp.d) ?? today);
  const cells = monthGrid(month);
  const upcomingEnd = addDays(today, 14);
  const gridEnd = cells[cells.length - 1]!.date;
  const [{ items, failed }, rooms] = await Promise.all([
    loadCalendarItems({ from: cells[0]!.date < today ? cells[0]!.date : today, to: gridEnd > upcomingEnd ? gridEnd : upcomingEnd, today }),
    listRoomOptions(),
  ]);
  const inGrid = items.filter((i) => i.date >= cells[0]!.date && i.date <= gridEnd);
  const upcoming = items.filter((i) => i.date >= today && i.date <= upcomingEnd);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Calendar</h1>
      {failed > 0 && (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-4 py-3 text-sm font-medium text-warning-fg">
          Some items could not be loaded, so this calendar may be incomplete.
        </p>
      )}
      <EventForm action={addEventAction} defaultDate={selected} rooms={rooms} />
      <MonthGrid month={month} items={inGrid} today={today} selected={selected} />
      <Agenda selected={selected} today={today} items={inGrid} upcoming={upcoming} datePrefs={session.datePrefs} />
      <p className="text-xs text-muted">Google Calendar sync: later</p>
    </div>
  );
}
