# Repository push error: diagnosis

## What was checked
- No file in the project is close to GitHub's 100 MB limit.
- No real secrets were found. The only match is a search pattern in a recovery safety script.
- The repository has a "Repository Policy" check that fails any commit on `main` that didn't come through a merged pull request.

## Most likely cause (not yet confirmed)
GitHub branch protection on `main` requires pull requests, so it rejects Lovable's direct pushes. When that happens, Lovable sends its work to a `lovable-sync` branch, or a `lovable-sync-<timestamp>` branch if `lovable-sync` already exists.

## Steps to resolve (no code changes)
1. Open Project settings, then Git, and read the exact status message.
2. On GitHub, find the newest `lovable-sync*` branch.
3. Open a pull request from that branch into `main`, wait for the checks to pass, then merge it.
4. If the status says "diverged", merge the newest `lovable-sync*` branch before pushing anything else to `main`. Otherwise, the next push from GitHub can replace Lovable's version.
5. If the message mentions file size or secret protection instead, share the exact text so it can be diagnosed.
