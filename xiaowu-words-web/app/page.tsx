import Wordbook from './wordbook';
import { chatGPTSignInPath } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default function Home() { return <Wordbook signInPath={chatGPTSignInPath('/')} />; }
