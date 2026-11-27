import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { loadAttemptSnapshot, saveAttemptSnapshot } from "../store/attempt-runtime";
import { useAuthStore } from "../store/auth.store";
import { examGet, examWrite } from "../api/examination";
import { ActionError } from "./ExamData";

type Point = [number, number];
export type Stroke = { width: number; erase: boolean; points: Point[] };
const WIDTH = 480;
const HEIGHT = 320;
const LIMIT = 100_000;

export function Scratchpad({ path, disabled, initialNotes, initialSketch }: {
  path: string; disabled: boolean; initialNotes?: string; initialSketch?: Stroke[];
}) {
  const userId = useAuthStore(state=>state.user?.id);
  const storageKey = "scratchpad:"+(userId ?? "")+path;
  const [restored,setRestored] = useState(false);
  const [tab, setTab] = useState("notes");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [sketch, setSketch] = useState<Stroke[]>(initialSketch ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [width, setWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const [flushed, setFlushed] = useState(() => JSON.stringify({ notes: initialNotes ?? "", sketch: initialSketch ?? [] }));
  const canvas = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<Stroke | null>(null);
  const data = JSON.stringify({ notes, sketch });
  const bytes = new TextEncoder().encode(data).length;
  useEffect(()=>{let alive=true; void (async()=>{
    const local = await loadAttemptSnapshot(storageKey).catch(()=>undefined) as {notes:string;sketch:Stroke[]} | undefined;
    const remote = local ? undefined : await examGet<{content:string;strokes?:Stroke[]}>(path+"/scratchpad").catch(()=>undefined);
    if(alive) {setNotes(local?.notes ?? remote?.content ?? initialNotes ?? "");setSketch(local?.sketch ?? remote?.strokes ?? initialSketch ?? []);setRestored(true);}
  })();return ()=>{alive=false;};},[storageKey,path,initialNotes,initialSketch]);
  useEffect(()=>{if(restored) void saveAttemptSnapshot(storageKey,{notes,sketch}).catch(()=>undefined);},[restored,storageKey,notes,sketch]);
  const save = useMutation({
    mutationFn: (value: string) => examWrite(path + "/scratchpad", "PUT", {content: JSON.parse(value).notes, strokes: JSON.parse(value).sketch}),
    onSuccess: (_response, sent) => setFlushed(sent),
  });

  useEffect(() => {
    if (disabled || data === flushed || bytes > LIMIT || save.isPending || save.isError) return;
    const delay = window.setTimeout(() => save.mutate(data), 5000);
    return () => window.clearTimeout(delay);
  }, [bytes, data, disabled, flushed, save]);

  function draw(strokes: Stroke[]) {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    for (const current of strokes) {
      if (!current.points.length) continue;
      context.beginPath();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = current.width;
      context.strokeStyle = "#1f3a5f";
      context.globalCompositeOperation = current.erase ? "destination-out" : "source-over";
      const [start, ...rest] = current.points;
      context.moveTo(...start);
      if (rest.length === 0) context.lineTo(start[0] + .1, start[1]);
      rest.forEach((point) => context.lineTo(...point));
      context.stroke();
    }
    context.globalCompositeOperation = "source-over";
  }

  useEffect(() => { if (tab === "sketch") draw(sketch); }, [sketch, tab]);

  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.round((event.clientX - rect.left) * WIDTH / rect.width), Math.round((event.clientY - rect.top) * HEIGHT / rect.height)];
  }

  return <section className="account-card exam-record exam-scratchpad">
    <h2>Scratchpad</h2><p>Notes and sketches are not graded.</p>
    <div className="exam-tabs" role="group" aria-label="Scratchpad view">
      <button aria-pressed={tab === "notes"} onClick={() => setTab("notes")}>Notes</button>
      <button aria-pressed={tab === "sketch"} onClick={() => setTab("sketch")}>Sketch</button>
    </div>
    {tab === "notes" ? <div className="exam-form"><textarea aria-label="Scratchpad notes" maxLength={25_000} disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} /></div> :
      <>
        <div className="exam-actions">
          <button className="button" disabled={disabled} aria-pressed={erase} onClick={() => setErase(!erase)}>{erase ? "Eraser on" : "Eraser off"}</button>
          <label>Size <select disabled={disabled} value={width} onChange={(event) => setWidth(Number(event.target.value))}><option value={1}>Fine</option><option value={3}>Medium</option><option value={8}>Wide</option></select></label>
          <button className="button" disabled={disabled || !sketch.length} onClick={() => {
            const last = sketch.at(-1);
            if (last) { setRedo([...redo, last]); setSketch(sketch.slice(0, -1)); }
          }}>Undo</button>
          <button className="button" disabled={disabled || !redo.length} onClick={() => {
            const last = redo.at(-1);
            if (last) { setSketch([...sketch, last]); setRedo(redo.slice(0, -1)); }
          }}>Redo</button>
        </div>
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="scratch-canvas" aria-label="Scratchpad drawing area"
          onPointerDown={(event) => {
            if (disabled || bytes > LIMIT || !event.isPrimary) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            stroke.current = { width, erase, points: [point(event)] };
            draw([...sketch, stroke.current]);
          }}
          onPointerMove={(event) => {
            if (!stroke.current || !event.currentTarget.hasPointerCapture(event.pointerId) || stroke.current.points.length >= 2000) return;
            stroke.current.points.push(point(event));
            draw([...sketch, stroke.current]);
          }}
          onPointerUp={(event) => {
            if (!stroke.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            setSketch([...sketch, stroke.current]);
            setRedo([]);
            stroke.current = null;
          }}
          onPointerCancel={() => { stroke.current = null; draw(sketch); }} />
      </>}
    <small>{Math.round(bytes / 1000)} / 100 KB</small>
    {bytes > LIMIT && <p role="alert">Remove notes or strokes before saving.</p>}
    <p role="status">{save.isPending ? "Saving scratchpad…" : data === flushed ? "Scratchpad saved" : "Scratchpad changes pending"}</p>
    <ActionError error={save.error} />
    <button className="button" disabled={disabled || data === flushed || bytes > LIMIT || save.isPending} onClick={() => save.mutate(data)}>Save scratchpad</button>
  </section>;
}
