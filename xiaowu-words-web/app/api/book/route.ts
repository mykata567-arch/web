import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { createBookService } from '../../../lib/book-service.mjs';
export const dynamic = 'force-dynamic';
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
async function handle(request: Request, write: boolean) {
  try {
    if (!env.DB) return response({ error: 'DATABASE_UNAVAILABLE', message: '云端字本暂时不可用，请稍后重试' }, 503);
    if (write && request.headers.get('origin') !== new URL(request.url).origin) return response({ error: 'FORBIDDEN', message: '请求来源无效' }, 403);
    const user = await getChatGPTUser();
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    const service = createBookService(env.DB);
    if (!write) return response(await service.session(token, user?.userId));
    const text = await request.text();
    if (text.length > 16000) return response({ error: 'TOO_LARGE', message: '一次录入的内容太多了' }, 413);
    let event; try { event = JSON.parse(text); } catch { return response({ error: 'INVALID_INPUT', message: '提交内容格式有误' }, 400); }
    const data = await service.action(event, token, user?.userId, request.headers.get('cf-connecting-ip') || 'anonymous');
    return response(data);
  } catch (error: any) {
    const code = error.code || 'INTERNAL_ERROR';
    const status = code === 'UNAUTHORIZED' || code === 'SIGN_IN_REQUIRED' ? 401 : ['FORBIDDEN', 'NOT_FOUND'].includes(code) ? 403 : code === 'STALE_WORD' ? 409 : code === 'INTERNAL_ERROR' ? 500 : 400;
    if (status === 500) console.error('Book request failed', error.message);
    return response({ error: code, message: status === 500 ? '保存暂时没有完成，请稍后重试' : error.message }, status);
  }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
