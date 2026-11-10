import { readTraction, TRACTION_CONTRACT } from '../src/traction.ts';

console.log(JSON.stringify(await readTraction(process.argv[2] || TRACTION_CONTRACT)));
