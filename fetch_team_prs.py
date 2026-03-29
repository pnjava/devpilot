#!/usr/bin/env python3
import urllib.request, json, datetime, sys

TOKEN = sys.argv[1]

TEAM = [
    "Narendra Kumar", "Kumaran Venkataraman", "Nithya Masanapothydurai",
    "Vikeshkumar Gupta", "Akshay Kumar", "Vidyasagar Yedireswarapu",
    "Meenakshi Gupta", "Ashiskumar Parida", "Deep Narayan Kumar",
    "Gulshan Kumar", "Raghul Selvam", "Onkar Mishra",
    "Supriya Bagade", "Rajani Subramanyam", "Akash Patel",
    "AhilSnekaPriya Balakrishnan", "Ajay Gaikwad", "Ritesh Khadgaray",
    "Gowtham Vepuri", "Sneha Mishra", "Rajesh Kanagaraju",
    "Gokul Prashanth", "Prateek Jain", "Ketan Pande",
    "Nagadarshan AH", "Preethi Muruganantham", "Prince Allwin",
    "Vandana Singh", "Sreekanth S", "Kithiyons Irudhayaraj",
    "Santhoshkumar Anbalagan", "Hariprasad Perupurayil"
]
team_lower = [n.lower() for n in TEAM]

def is_team_member(author_name):
    a = author_name.lower().strip()
    for t in team_lower:
        if a == t:
            return True
        parts_t = t.split()
        parts_a = a.split()
        if any(p in parts_a for p in parts_t if len(p) > 3):
            return True
    return False

def api(path):
    req = urllib.request.Request(
        f"http://localhost:4000/api{path}",
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

repos = api("/bitbucket/repos")
all_prs = []

for repo in repos:
    slug = repo["slug"]
    try:
        prs = api(f"/bitbucket/repos/{slug}/pull-requests?state=OPEN")
        for pr in prs:
            if is_team_member(pr.get("author", "")):
                pr["repo"] = slug
                all_prs.append(pr)
        print(f"  {slug}: {len(prs)} open PRs, {sum(1 for p in prs if is_team_member(p.get('author','')))} from team", file=sys.stderr)
    except Exception as e:
        print(f"  Error {slug}: {e}", file=sys.stderr)

all_prs.sort(key=lambda p: p.get("createdDate", 0), reverse=True)

print(f"\n{'='*80}")
print(f"OPEN PRs by Team Members  (total: {len(all_prs)})")
print(f"{'='*80}\n")

for pr in all_prs:
    created = datetime.datetime.fromtimestamp(pr['createdDate']/1000).strftime('%Y-%m-%d')
    reviewers = ", ".join([f"{r['name']} ({r['status']})" for r in pr.get("reviewers", [])])
    print(f"PR #{pr['id']:4}  [{pr['repo']}]  {created}")
    print(f"  Author  : {pr['author']}")
    print(f"  Title   : {pr['title']}")
    print(f"  Branch  : {pr['branch']} → {pr['target']}")
    print(f"  Reviews : {reviewers or 'none'}")
    print(f"  URL     : {pr['url']}")
    print()
