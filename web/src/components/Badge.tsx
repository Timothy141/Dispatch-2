import { label } from '../format';

export function Badge({ value, kind }: { value: string; kind?: 'status' }) {
  return <span className={`badge ${value} ${kind ?? ''}`}>{label(value)}</span>;
}
