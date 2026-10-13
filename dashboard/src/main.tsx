import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  CheckSquare,
  Home,
  Image,
  House,
  Settings as SettingsIcon,
  LogOut,
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  Trophy,
} from "lucide-react";
import { api } from "./api";
import {
  localDate,
  type Person,
  type Chore,
  type Settings,
} from "../server/domain";
import "./style.css";

type Event = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  personId: string;
  location: string;
};
type Task = Chore & { period: string | null; completed: boolean };
type Data = {
  settings: Settings;
  people: Person[];
  chores: Task[];
  completions: any[];
  role: string;
};
type Integration = {
  data: any[];
  updated: number | null;
  stale: boolean;
  error: string | null;
};
const emptyIntegration: Integration = {
  data: [],
  updated: null,
  stale: false,
  error: null,
};
const isAdmin = location.pathname.startsWith("/admin");
const dateLabel = (
  date: string,
  format: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" },
) =>
  new Intl.DateTimeFormat("en-US", { ...format, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
const timeLabel = (date: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
function ErrorBox({ message }: { message: string }) {
  return (
    <div className="notice error" role="alert">
      {message}
    </div>
  );
}
function Status({ value, label }: { value: Integration; label: string }) {
  return value.error ? (
    <div className="notice error">
      {label}: {value.error}
      {value.updated && (
        <small>
          Showing saved data from{" "}
          {new Date(value.updated * 1000).toLocaleString()}.
        </small>
      )}
    </div>
  ) : null;
}
function App() {
  const [role, setRole] = useState<string | null>(null),
    [checking, setChecking] = useState(true),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  const [tab, setTab] = useState("today"),
    [clock, setClock] = useState(new Date()),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [cal, setCal] = useState<any[]>([]),
    [photos, setPhotos] = useState<Integration>(emptyIntegration),
    [home, setHome] = useState<Integration>(emptyIntegration),
    [photoIndex, setPhotoIndex] = useState(0);
  async function load() {
    try {
      setData(await api("/dashboard"));
      setError("");
    } catch (e) {
      if ((e as any).status === 401) {
        setRole(null);
        setData(null);
      }
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    api("/auth/session")
      .then((x) => setRole(x.role))
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
    const t = setInterval(() => setClock(new Date()), 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!role) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [role]);
  useEffect(() => {
    if (!role) return;
    let active = true;
    const date = new Date(month + "-01T00:00:00Z");
    const from = new Date(date.getTime() - 7 * 86400000).toISOString();
    const to = new Date(date.getTime() + 45 * 86400000).toISOString();
    async function integrations() {
      const results = await Promise.allSettled([
        api("/calendar?" + new URLSearchParams({ from, to })),
        api("/photos"),
        api("/home"),
      ]);
      if (!active) return;
      if (results[0].status === "fulfilled") setCal(results[0].value);
      else
        setCal([
          {
            email: "Calendar",
            data: [],
            error: results[0].reason.message,
            stale: true,
            updated: null,
          },
        ]);
      if (results[1].status === "fulfilled") setPhotos(results[1].value);
      else {
        const error = results[1].reason.message;
        setPhotos((x) => ({ ...x, error }));
      }
      if (results[2].status === "fulfilled") setHome(results[2].value);
      else {
        const error = results[2].reason.message;
        setHome((x) => ({ ...x, error }));
      }
    }
    integrations();
    const t = setInterval(integrations, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [role, month]);
  useEffect(() => {
    const t = setInterval(
      () =>
        setPhotoIndex((i) =>
          photos.data.length
            ? data?.settings.shuffle
              ? Math.floor(Math.random() * photos.data.length)
              : (i + 1) % photos.data.length
            : 0,
        ),
      (data?.settings.photoSeconds || 20) * 1000,
    );
    return () => clearInterval(t);
  }, [photos.data.length, data?.settings.photoSeconds, data?.settings.shuffle]);
  const events: Event[] = cal
    .flatMap((x) => x.data || [])
    .sort((a, b) => a.start.localeCompare(b.start));
  if (checking) return <div className="gate">Loading Home HQ…</div>;
  if (!role || (isAdmin && role !== "admin"))
    return <Login onLogin={setRole} initialError={error} />;
  if (!data)
    return (
      <div className="gate">
        {error ? <ErrorBox message={error} /> : <p>Loading your household…</p>}
        <button onClick={load}>Retry</button>
      </div>
    );
  const tz = data.settings.timezone;
  const today = localDate(clock, tz);
  const todayEvents = events.filter((e) =>
    e.allDay
      ? e.start <= today && e.end > today
      : localDate(new Date(e.start), tz) === today,
  );
  const next = events.find(
    (e) => !e.allDay && Date.parse(e.end) > clock.getTime(),
  );
  const person = (pid: string) => data.people.find((p) => p.id === pid);
  const photo = photos.data[photoIndex % Math.max(1, photos.data.length)];
  const navigation = [
    ["today", "Today", House],
    ["calendar", "Calendar", CalendarDays],
    ["chores", "Chores", CheckSquare],
    ["photos", "Photos", Image],
    ["home", "Home", Home],
  ] as const;
  const complete = async (chore: Task, pid?: string) => {
    try {
      await api("/completions", "POST", { choreId: chore.id, personId: pid });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const canComplete = role === "admin" || data.settings.frameCompletion;
  return (
    <div className={isAdmin ? "admin-shell" : "display-shell"}>
      {isAdmin ? (
        <Admin data={data} reload={load} setRole={setRole} />
      ) : (
        <>
          <nav className="rail" aria-label="Dashboard sections">
            {navigation.map(([key, label, Icon]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                <Icon size={26} />
                <span>{label}</span>
              </button>
            ))}
            <div className="rail-bottom">
              {timeLabel(clock.toISOString(), tz)}
              <small>{data.settings.familyName}</small>
            </div>
          </nav>
          <main className="display-main">
            {error && <ErrorBox message={error} />}
            {tab === "today" && (
              <>
                <header className="today-header">
                  <div>
                    <div className="clock">
                      {new Intl.DateTimeFormat("en-US", {
                        timeZone: tz,
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(clock)}
                    </div>
                    <div className="date-line">
                      <b>{dateLabel(today, { weekday: "long" })}</b>{" "}
                      {dateLabel(today)}
                    </div>
                  </div>
                  <div className="family-summary">
                    {data.people.map((p) => (
                      <div key={p.id}>
                        <Avatar person={p} />
                        <strong>{p.name}</strong>
                        <span>{p.points || 0} pts</span>
                      </div>
                    ))}
                  </div>
                </header>
                <div className="today-grid">
                  <section className="next-event">
                    <span className="eyebrow">
                      {next
                        ? "Next up · " +
                          (person(next.personId)?.name || "Family")
                        : "Your household"}
                    </span>
                    <h1>{next?.title || "Room for a little downtime."}</h1>
                    <p>
                      {next
                        ? (localDate(new Date(next.start), tz) === today
                            ? ""
                            : dateLabel(localDate(new Date(next.start), tz)) +
                              " · ") +
                          timeLabel(next.start, tz) +
                          (next.location ? " · " + next.location : "")
                        : "Connect your calendars in the browser admin area."}
                    </p>
                  </section>
                  <Photo image={photo} />
                  <section className="card">
                    <h2>Today’s calendar</h2>
                    <EventList
                      events={todayEvents}
                      people={data.people}
                      tz={tz}
                    />
                  </section>
                  <section className="card">
                    <h2>Chores · Today</h2>
                    <Chores
                      tasks={data.chores}
                      people={data.people}
                      canComplete={canComplete}
                      complete={complete}
                    />
                  </section>
                </div>
                {cal.map((x, i) => (
                  <Status key={i} value={x} label={x.email} />
                ))}
              </>
            )}
            {tab === "calendar" && (
              <Calendar
                events={events}
                people={data.people}
                tz={tz}
                month={month}
                setMonth={setMonth}
                today={today}
                sources={cal}
              />
            )}
            {tab === "chores" && (
              <>
                <PageTitle
                  title="Chores"
                  subtitle="A little teamwork, every day."
                />
                <div className="scores">
                  {data.people.map((p) => (
                    <div className="card score" key={p.id}>
                      <Avatar person={p} />
                      <strong>{p.name}</strong>
                      <span>
                        <Trophy size={24} />
                        {p.points || 0} points
                      </span>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <Chores
                    tasks={data.chores}
                    people={data.people}
                    canComplete={canComplete}
                    complete={complete}
                  />
                </div>
              </>
            )}
            {tab === "photos" && (
              <>
                <PageTitle
                  title="Photos"
                  subtitle="From your shared family album."
                />
                <Status value={photos} label="Google Photos" />
                <div className="slideshow">
                  <Photo image={photo} />
                </div>
                <p className="muted">
                  {photos.data.length
                    ? `${(photoIndex % photos.data.length) + 1} of ${photos.data.length} photos · ${data.settings.photoSeconds} seconds per photo`
                    : "Add a shared-album link in the browser admin area."}
                </p>
              </>
            )}
            {tab === "home" && (
              <>
                <PageTitle
                  title="Home"
                  subtitle="Live status from Home Assistant."
                />
                <Status value={home} label="Home Assistant" />
                <div className="home-grid">
                  {home.data.map((x) => (
                    <HomeEntity
                      key={x.id}
                      entity={x}
                      controls={role === "admin" || data.settings.homeControls}
                      act={async (action, value) => {
                        try {
                          await api("/home/action", "POST", {
                            entityId: x.id,
                            action,
                            value,
                          });
                          setHome(await api("/home"));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  ))}
                </div>
                {!home.data.length && (
                  <Empty>
                    Choose Home Assistant entities in the browser admin area.
                  </Empty>
                )}
                <p className="muted">
                  Status refreshes every 30 seconds. Home controls can be
                  enabled in browser settings.
                </p>
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}
function HomeEntity({
  entity: x,
  controls,
  act,
}: {
  entity: any;
  controls: boolean;
  act: (action: string, value?: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [temperature, setTemperature] = useState<number>(x.targetTemperature || 20);
  const domain = x.id.split(".")[0];
  useEffect(() => {
    if (x.targetTemperature !== undefined) setTemperature(x.targetTemperature);
  }, [x.targetTemperature]);
  async function run(action: string, value?: number) {
    setBusy(true);
    try {
      await act(action, value);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card entity">
      <Home size={28} />
      <h2>{x.name}</h2>
      <strong>
        {x.state} {x.unit}
      </strong>
      {x.temperature !== undefined && <p>Inside {x.temperature}°</p>}
      {controls && x.state !== "unavailable" && (
        <div className="entity-controls">
          {["light", "switch"].includes(domain) && (
            <button
              disabled={busy}
              onClick={() => run(x.state === "on" ? "turn_off" : "turn_on")}
            >
              {x.state === "on" ? "Turn off" : "Turn on"}
            </button>
          )}
          {["scene", "script"].includes(domain) && (
            <button disabled={busy} onClick={() => run("turn_on")}>
              Activate
            </button>
          )}
          {domain === "cover" && (
            <>
              <button disabled={busy} onClick={() => run("open_cover")}>
                Open
              </button>
              <button disabled={busy} onClick={() => run("close_cover")}>
                Close
              </button>
              <button disabled={busy} onClick={() => run("stop_cover")}>
                Stop
              </button>
            </>
          )}
          {domain === "climate" && (
            <>
              <label>
                Target temperature
                <input
                  type="number"
                  min={x.minTemperature}
                  max={x.maxTemperature}
                  step="0.5"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </label>
              <button
                disabled={busy || !Number.isFinite(temperature)}
                onClick={() => run("set_temperature", temperature)}
              >
                Set temperature
              </button>
            </>
          )}
        </div>
      )}
      <small>{x.id}</small>
    </div>
  );
}
function Login({
  onLogin,
  initialError,
}: {
  onLogin: (r: string) => void;
  initialError: string;
}) {
  const [value, setValue] = useState(""),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  return (
    <div className="gate">
      <span className="eyebrow">Home HQ</span>
      <h1>{isAdmin ? "Your household, your way." : "Welcome home."}</h1>
      <p>
        {isAdmin
          ? "Sign in to manage family, chores, and connections."
          : "Enter a pairing code from the browser admin area."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const x = await api(
              isAdmin ? "/auth/login" : "/auth/pair",
              "POST",
              isAdmin ? { password: value } : { code: value },
            );
            onLogin(x.role);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {isAdmin ? "Admin password" : "Six-digit pairing code"}
          <input
            autoComplete={isAdmin ? "current-password" : "off"}
            type={isAdmin ? "password" : "text"}
            inputMode={isAdmin ? undefined : "numeric"}
            maxLength={isAdmin ? undefined : 6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <button disabled={busy} className="primary">
          {busy ? "Connecting…" : isAdmin ? "Sign in" : "Pair display"}
        </button>
      </form>
      {error && <ErrorBox message={error} />}
      <a href={isAdmin ? "/" : "/admin"}>
        {isAdmin ? "Open the display" : "Manage in your browser"}
      </a>
    </div>
  );
}
function Avatar({ person }: { person: Person }) {
  return (
    <span className="avatar" style={{ background: person.color }}>
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
function Photo({ image }: { image?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return (
    <div className="photo">
      {image && !failed ? (
        <img
          src={image}
          alt="Family album photograph"
          onError={() => setFailed(true)}
        />
      ) : (
        <div>
          <Image size={44} />
          <p>
            {failed
              ? "Photo unavailable. Waiting for the next image."
              : "Your family photos belong here."}
          </p>
        </div>
      )}
    </div>
  );
}
function EventList({
  events,
  people,
  tz,
}: {
  events: Event[];
  people: Person[];
  tz: string;
}) {
  return events.length ? (
    <div className="event-list">
      {events.map((e) => {
        const p = people.find((x) => x.id === e.personId);
        return (
          <div
            className="event"
            style={{ borderColor: p?.color || "#111" }}
            key={e.id}
          >
            <span>{e.allDay ? "All day" : timeLabel(e.start, tz)}</span>
            <div>
              <strong>{e.title}</strong>
              <small>
                {p?.name}
                {e.location ? " · " + e.location : ""}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <Empty>No events scheduled.</Empty>
  );
}
function Chores({
  tasks,
  people,
  canComplete,
  complete,
}: {
  tasks: Task[];
  people: Person[];
  canComplete: boolean;
  complete: (t: Task, pid?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [assignees, setAssignees] = useState<Record<string, string>>({});
  const visible = tasks.filter(
    (t) => t.period !== null && !(t.recurrence === "once" && t.completed),
  );
  return visible.length ? (
    <div className="chore-list">
      {visible.map((t) => (
        <div className={"chore " + (t.completed ? "done" : "")} key={t.id}>
          <div>
            <strong>{t.title}</strong>
            <small>
              {people.find((p) => p.id === t.person_id)?.name || "Anyone"} ·{" "}
              {t.recurrence} · {t.points} pts
            </small>
          </div>
          {canComplete && !t.completed && !t.person_id && (
            <select
              aria-label={"Who completed " + t.title}
              value={assignees[t.id] || ""}
              onChange={(e) =>
                setAssignees({ ...assignees, [t.id]: e.target.value })
              }
            >
              <option value="">Who?</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="complete"
            disabled={
              t.completed ||
              !canComplete ||
              busy === t.id ||
              (!t.person_id && !assignees[t.id])
            }
            onClick={async () => {
              setBusy(t.id);
              await complete(t, assignees[t.id]);
              setBusy(null);
            }}
          >
            {t.completed ? "✓ Done" : canComplete ? "Complete" : "To do"}
          </button>
        </div>
      ))}
    </div>
  ) : (
    <Empty>No chores due. Add chores in the browser admin area.</Empty>
  );
}
function Calendar({
  events,
  people,
  tz,
  month,
  setMonth,
  today,
  sources,
}: {
  events: Event[];
  people: Person[];
  tz: string;
  month: string;
  setMonth: (m: string) => void;
  today: string;
  sources: any[];
}) {
  const [selected, setSelected] = useState(today);
  const first = new Date(month + "-01T12:00:00Z");
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) =>
    new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
  );
  const forDay = (day: string) =>
    events.filter((e) =>
      e.allDay
        ? e.start <= day && e.end > day
        : localDate(new Date(e.start), tz) === day,
    );
  const move = (n: number) => {
    const d = new Date(first);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <>
      <div className="calendar-heading">
        <h1>{dateLabel(month + "-01", { month: "long", year: "numeric" })}</h1>
        <div>
          <button onClick={() => move(-1)} aria-label="Previous month">
            ←
          </button>
          <button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
          >
            Today
          </button>
          <button onClick={() => move(1)} aria-label="Next month">
            →
          </button>
        </div>
      </div>
      {sources.map((x, i) => (
        <Status key={i} value={x} label={x.email} />
      ))}
      <div className="calendar-layout">
        <div>
          <div className="weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {days.map((day) => (
              <button
                key={day}
                onClick={() => setSelected(day)}
                className={
                  (day === selected ? "selected " : "") +
                  (day === today ? "today " : "") +
                  (day.slice(0, 7) !== month ? "outside" : "")
                }
              >
                <b>{Number(day.slice(-2))}</b>
                {forDay(day)
                  .slice(0, 3)
                  .map((e) => (
                    <span
                      key={e.id}
                      style={{
                        borderColor: people.find((p) => p.id === e.personId)
                          ?.color,
                      }}
                    >
                      {e.title}
                    </span>
                  ))}
                {forDay(day).length > 3 && (
                  <small>+{forDay(day).length - 3} more</small>
                )}
              </button>
            ))}
          </div>
        </div>
        <section className="card agenda">
          <h2>
            {dateLabel(selected, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <EventList events={forDay(selected)} people={people} tz={tz} />
        </section>
      </div>
    </>
  );
}

function Admin({
  data,
  reload,
  setRole,
}: {
  data: Data;
  reload: () => Promise<void>;
  setRole: (r: string | null) => void;
}) {
  const [tab, setTab] = useState("family"),
    [config, setConfig] = useState<any>(null),
    [accounts, setAccounts] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState("");
  const [person, setPerson] = useState({ id: "", name: "", color: "#2D5BFF" }),
    [chore, setChore] = useState({
      id: "",
      title: "",
      person_id: "",
      points: 5,
      recurrence: "daily",
      start_date: localDate(new Date(), data.settings.timezone),
    });
  const [accountPerson, setAccountPerson] = useState("");
  async function refresh() {
    try {
      const [c, a] = await Promise.all([
        api("/admin/settings"),
        api("/admin/google"),
      ]);
      setConfig({ ...c, haToken: "" });
      setAccounts(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
      await refresh();
      setNotice("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="admin-header">
        <div>
          <span className="eyebrow">Home HQ · Admin</span>
          <h1>{data.settings.familyName}</h1>
        </div>
        <div>
          <a className="button" href="/">
            View dashboard
          </a>
          <button
            onClick={() =>
              action(async () => {
                await api("/auth/logout", "POST");
                setRole(null);
              })
            }
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </header>
      <nav className="admin-tabs">
        {["family", "chores", "calendars", "photos", "home", "display"].map(
          (x) => (
            <button
              className={tab === x ? "active" : ""}
              key={x}
              onClick={() => {
                setTab(x);
                setNotice("");
              }}
            >
              {x}
            </button>
          ),
        )}
      </nav>
      {error && <ErrorBox message={error} />}
      <div aria-live="polite">
        {notice && <p className="notice">{notice}</p>}
      </div>
      {tab === "family" && (
        <div className="admin-columns">
          <section className="card">
            <h2>Family members</h2>
            {data.people.map((p) => (
              <div className="edit-row" key={p.id}>
                <Avatar person={p} />
                <strong>{p.name}</strong>
                <span>{p.points || 0} points</span>
                <button
                  aria-label={"Edit " + p.name}
                  onClick={() =>
                    setPerson({ id: p.id, name: p.name, color: p.color })
                  }
                >
                  <Pencil size={18} />
                </button>
                <button
                  aria-label={"Archive " + p.name}
                  onClick={() => {
                    if (
                      confirm(
                        "Archive " +
                          p.name +
                          "? History stays saved; assigned chores become unassigned.",
                      )
                    )
                      action(() => api("/admin/people/" + p.id, "DELETE"));
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {!data.people.length && (
              <Empty>Add your family members to get started.</Empty>
            )}
          </section>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api("/admin/people", "POST", person);
                setPerson({ id: "", name: "", color: "#2D5BFF" });
              });
            }}
          >
            <h2>{person.id ? "Edit family member" : "Add family member"}</h2>
            <label>
              Name
              <input
                value={person.name}
                required
                maxLength={120}
                onChange={(e) => setPerson({ ...person, name: e.target.value })}
              />
            </label>
            <label>
              Calendar color
              <input
                type="color"
                value={person.color}
                onChange={(e) =>
                  setPerson({ ...person, color: e.target.value })
                }
              />
            </label>
            <button className="primary" disabled={busy}>
              Save member
            </button>
            {person.id && (
              <button
                type="button"
                onClick={() =>
                  setPerson({ id: "", name: "", color: "#2D5BFF" })
                }
              >
                Cancel
              </button>
            )}
          </form>
        </div>
      )}
      {tab === "chores" && (
        <>
          <div className="admin-columns">
            <section className="card">
              <h2>Chore list</h2>
              {data.chores.map((t) => (
                <div className="edit-row" key={t.id}>
                  <div>
                    <strong>{t.title}</strong>
                    <small>
                      {data.people.find((p) => p.id === t.person_id)?.name ||
                        "Anyone"}{" "}
                      · {t.recurrence} · {t.points} points
                    </small>
                  </div>
                  <button
                    aria-label={"Edit " + t.title}
                    onClick={() =>
                      setChore({ ...t, person_id: t.person_id || "" })
                    }
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    aria-label={"Archive " + t.title}
                    onClick={() => {
                      if (confirm("Archive this chore?"))
                        action(() => api("/admin/chores/" + t.id, "DELETE"));
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              <Chores
                tasks={data.chores}
                people={data.people}
                canComplete
                complete={async (t, pid) =>
                  action(() =>
                    api("/completions", "POST", {
                      choreId: t.id,
                      personId: pid,
                    }),
                  )
                }
              />
            </section>
            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api("/admin/chores", "POST", chore);
                  setChore({
                    id: "",
                    title: "",
                    person_id: "",
                    points: 5,
                    recurrence: "daily",
                    start_date: localDate(new Date(), data.settings.timezone),
                  });
                });
              }}
            >
              <h2>{chore.id ? "Edit chore" : "Add chore"}</h2>
              <label>
                Chore
                <input
                  required
                  maxLength={120}
                  value={chore.title}
                  onChange={(e) =>
                    setChore({ ...chore, title: e.target.value })
                  }
                />
              </label>
              <label>
                Assigned to
                <select
                  value={chore.person_id}
                  onChange={(e) =>
                    setChore({ ...chore, person_id: e.target.value })
                  }
                >
                  <option value="">Anyone</option>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Repeat
                <select
                  value={chore.recurrence}
                  onChange={(e) =>
                    setChore({ ...chore, recurrence: e.target.value })
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">
                    Weekly, starting on the date below
                  </option>
                  <option value="once">Once</option>
                </select>
              </label>
              <label>
                Start date
                <input
                  type="date"
                  required
                  value={chore.start_date}
                  onChange={(e) =>
                    setChore({ ...chore, start_date: e.target.value })
                  }
                />
              </label>
              <label>
                Points
                <input
                  type="number"
                  min={0}
                  max={1000}
                  required
                  value={chore.points}
                  onChange={(e) =>
                    setChore({ ...chore, points: Number(e.target.value) })
                  }
                />
              </label>
              <button disabled={busy} className="primary">
                Save chore
              </button>
            </form>
          </div>
          <section className="card history">
            <h2>Completion history</h2>
            <p>
              Points are awarded once per chore per recurrence period. Undo
              removes the awarded points.
            </p>
            {data.completions.slice(0, 50).map((x) => (
              <div className="edit-row" key={x.id}>
                <div>
                  <strong>{x.title}</strong>
                  <small>
                    {data.people.find((p) => p.id === x.person_id)?.name ||
                      "Archived member"}{" "}
                    · {new Date(x.completed_at).toLocaleString()} · +{x.points}{" "}
                    points
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(() => api("/admin/completions/" + x.id, "DELETE"))
                  }
                >
                  Undo
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "calendars" && (
        <>
          <section className="card">
            <h2>Google Calendar connections</h2>
            <p>
              Each person connects their own Google account. Calendar access is
              read-only.
            </p>
            {!config?.googleConfigured && (
              <ErrorBox message="Google OAuth credentials need to be configured on the Worker before connecting accounts." />
            )}
            <div className="inline-form">
              <select
                aria-label="Family member for Google connection"
                value={accountPerson}
                onChange={(e) => setAccountPerson(e.target.value)}
              >
                <option value="">Choose a family member</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!accountPerson || !config?.googleConfigured}
                onClick={() => {
                  location.href =
                    "/api/admin/google/start?personId=" +
                    encodeURIComponent(accountPerson);
                }}
              >
                Connect Google account
              </button>
            </div>
          </section>
          {accounts.map((a) => (
            <GoogleAccount
              key={a.id}
              account={a}
              people={data.people}
              action={action}
            />
          ))}
        </>
      )}
      {config && ["photos", "home", "display"].includes(tab) && (
        <form
          className="card settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            action(() => api("/admin/settings", "PUT", config));
          }}
        >
          {tab === "photos" && (
            <>
              <h2>Shared Google Photos album</h2>
              <label>
                Album share link
                <input
                  type="url"
                  placeholder="https://photos.app.goo.gl/…"
                  value={config.albumUrl}
                  onChange={(e) =>
                    setConfig({ ...config, albumUrl: e.target.value })
                  }
                />
              </label>
              <p className="muted">
                Link sharing must be enabled. This unofficial adapter refreshes
                every 20 minutes and reads up to 500 image URLs from the shared
                page. Large albums and Google format changes may need additional
                support.
              </p>
              <label>
                Seconds per photo
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={config.photoSeconds}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      photoSeconds: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.shuffle}
                  onChange={(e) =>
                    setConfig({ ...config, shuffle: e.target.checked })
                  }
                />
                Shuffle photos
              </label>
            </>
          )}
          {tab === "home" && (
            <>
              <h2>Home Assistant</h2>
              <p>
                The endpoint must expose Home Assistant’s standard REST API over
                HTTPS. Choose which entities to display and whether the frame
                can control them.
              </p>
              <label>
                Home Assistant base URL
                <input
                  type="url"
                  placeholder="https://your-home-assistant.example"
                  value={config.haUrl}
                  onChange={(e) =>
                    setConfig({ ...config, haUrl: e.target.value })
                  }
                />
              </label>
              <label>
                Long-lived access token
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    config.haTokenConfigured
                      ? "Saved · leave blank to keep it"
                      : "Paste token"
                  }
                  value={config.haToken}
                  onChange={(e) =>
                    setConfig({ ...config, haToken: e.target.value })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!config.homeControls}
                  onChange={(e) =>
                    setConfig({ ...config, homeControls: e.target.checked })
                  }
                />
                Allow Home Assistant controls on the frame
              </label>
              <label>
                Entity IDs, one per line
                <textarea
                  rows={8}
                  value={config.haEntities.join("\n")}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      haEntities: e.target.value
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={
                    "light.kitchen\nsensor.living_room_temperature\nclimate.downstairs"
                  }
                />
              </label>
            </>
          )}
          {tab === "display" && (
            <>
              <h2>Display settings</h2>
              <label>
                Household name
                <input
                  required
                  value={config.familyName}
                  onChange={(e) =>
                    setConfig({ ...config, familyName: e.target.value })
                  }
                />
              </label>
              <label>
                Timezone
                <input
                  required
                  value={config.timezone}
                  onChange={(e) =>
                    setConfig({ ...config, timezone: e.target.value })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.frameCompletion}
                  onChange={(e) =>
                    setConfig({ ...config, frameCompletion: e.target.checked })
                  }
                />
                Allow chore completion on the frame
              </label>
              <p>
                Family and chore editing is always restricted to the browser
                admin area.
              </p>
            </>
          )}
          <button className="primary" disabled={busy}>
            Save settings
          </button>
        </form>
      )}
      {tab === "display" && (
        <section className="card">
          <h2>Pair your frame</h2>
          <p>
            Open this site on the frame and enter the code. It expires in ten
            minutes and works once.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const x = await api("/admin/pairing", "POST", {});
                setCode(x.code);
              })
            }
          >
            Generate pairing code
          </button>
          {code && <output className="pair-code">{code}</output>}
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Sign out every paired display?"))
                action(() => api("/admin/displays", "DELETE"));
            }}
          >
            Revoke display access
          </button>
        </section>
      )}
      <footer>
        <button
          disabled={busy}
          onClick={() => action(() => api("/admin/refresh", "POST", {}))}
        >
          <RefreshCw size={18} />
          Refresh integrations
        </button>
        <small>
          Updates are saved on your server and picked up by the frame
          automatically.
        </small>
      </footer>
    </>
  );
}
function GoogleAccount({
  account,
  people,
  action,
}: {
  account: any;
  people: Person[];
  action: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [list, setList] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>(account.calendars);
  return (
    <section className="card account">
      <h2>{account.email}</h2>
      <p>
        {people.find((p) => p.id === account.person_id)?.name ||
          "Archived member"}{" "}
        · {account.calendars.length} selected calendars
      </p>
      {error && <ErrorBox message={error} />}
      <button
        onClick={async () => {
          try {
            setList(await api("/admin/google/" + account.id + "/calendars"));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Choose calendars
      </button>
      {list && (
        <>
          <div className="calendar-options">
            {list.map((c) => (
              <label className="check" key={c.id}>
                <input
                  type="checkbox"
                  checked={
                    selected.includes(c.id) ||
                    (c.primary && selected.includes("primary"))
                  }
                  onChange={(e) => {
                    const existing = selected.filter(
                      (x) => x !== c.id && !(c.primary && x === "primary"),
                    );
                    setSelected(
                      e.target.checked ? [...existing, c.id] : existing,
                    );
                  }}
                />
                {c.summary}
              </label>
            ))}
          </div>
          <button
            className="primary"
            onClick={() =>
              action(() =>
                api("/admin/google/" + account.id, "PUT", {
                  calendars: selected,
                }),
              )
            }
          >
            Save calendar selection
          </button>
        </>
      )}
      <button
        className="danger"
        onClick={() => {
          if (confirm("Disconnect this Google account?"))
            action(() => api("/admin/google/" + account.id, "DELETE"));
        }}
      >
        Disconnect
      </button>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
