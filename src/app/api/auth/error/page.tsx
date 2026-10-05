import Link from "next/link";
export default function AuthErrorPage() { return <main className="auth-wrap"><section className="auth-panel"><h1>Prisijungti nepavyko</h1><p className="lead">Paprašyk naujos prisijungimo nuorodos.</p><Link className="primary-button" href="/prisijungti">Grįžti į prisijungimą</Link></section></main>; }
