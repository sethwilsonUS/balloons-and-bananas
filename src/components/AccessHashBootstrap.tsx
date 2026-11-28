import { ACCESS_HASH_BOOTSTRAP_SCRIPT } from '@/lib/legacy-redirects';

// Run in the document head before paint so obsolete `#access=...` sharing
// fragments are removed before hydration, hash handlers, or analytics run,
// while all other fragments (`#pN`, `#t=`, `#inferred-ages`, etc.) stay intact.
export default function AccessHashBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: ACCESS_HASH_BOOTSTRAP_SCRIPT }} />;
}
