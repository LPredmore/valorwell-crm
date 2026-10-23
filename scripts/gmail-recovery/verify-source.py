"""Offline deployment-source binding; no database/provider credentials or calls."""
import hashlib
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PINS = {
    'supabase/migrations/20261022195806_relationship_source_identity_gate.sql': 'b33c995f3fe7d169421dd23b70bf4afc6ce0ecba0729195ca214c6778c95fe83',
    'supabase/migrations/20261022195848_relationship_review_organization_completion.sql': '504a1a9d36509918f8b9a004d8088df6ad312518d17ee8be003012692996d4e9',
    'supabase/migrations/20261022195938_relationship_source_recovery_report.sql': '38bf1a4a1a45d234fc3e45edc09a9497c33ece83f4903ec05532ae909f090a5c',
    'supabase/migrations/20261022200829_relationship_secondary_to_recipients.sql': 'df85e8451e21334c071dd6084ece798a1d00b3ac4298b65b35524ab2e934512a',
    'supabase/functions/_shared/relationship-google-sync.ts': '484d0d3d2210f0e88a4374442ba1e053d3482124a31860773757537f9e623689',
}

def verify():
    for name, expected in PINS.items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned Gmail source changed: reviewed rebase required')
    for patch, original, candidate in [
        ('worker.patch','supabase/functions/_shared/relationship-google-sync.ts','relationship-google-sync.candidate.ts'),
        ('daily-monitor.patch','supabase/functions/valorwell-daily-operations-watch/index.ts','daily-monitor.candidate.ts'),
    ]:
        with tempfile.TemporaryDirectory() as directory:
            dest=Path(directory)/original
            dest.parent.mkdir(parents=True)
            dest.write_bytes((ROOT/original).read_bytes())
            result=subprocess.run(['patch','--batch','--forward','--fuzz=0','-p1','-i',str(ROOT/'scripts/gmail-recovery'/patch)],cwd=directory,capture_output=True)
            if result.returncode or dest.read_bytes() != (ROOT/'scripts/gmail-recovery'/candidate).read_bytes():
                raise ValueError('Candidate no longer equals reviewed source patch')

if __name__ == '__main__':
    try:
        verify()
    except (ValueError,OSError):
        print('GMAIL_SOURCE_CONTRACT_FAIL: review required; no deployment authorized')
        raise SystemExit(2)
    print('GMAIL_SOURCE_CONTRACT_PASS: offline only; live deployment/security/provider checks pending')