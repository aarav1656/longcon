import { readTractionEvents } from '../src/traction.ts';

const result = await readTractionEvents(process.argv[2]);
for (const category of ['pitches', 'loans', 'defaults'] as const) {
  const event = { pitches: 'offer_opened', loans: 'offer_settled', defaults: 'con_landed' }[category];
  const count = result.events.filter((row) => row.event === event).length;
  if (!count) throw new Error(`no finalized ${event} events found`);
}
console.log(JSON.stringify({ read_at_utc: new Date().toISOString(), ...result }));
