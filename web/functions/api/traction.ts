import { readTraction, TRACTION_CONTRACT } from '../../src/traction';

export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  try {
    const contractId = new URL(request.url).searchParams.get('contract_id') || TRACTION_CONTRACT;
    return Response.json(await readTraction(contractId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
