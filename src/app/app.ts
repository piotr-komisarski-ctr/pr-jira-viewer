import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

const ES_URL =
  'https://vpc-dx-observer-dev-domain-4s3zhb3bgg2q4ki4qt4bnzad4m.us-east-1.es.amazonaws.com';
const INDEX = 'pr-jira-map-1';
const JIRA_BROWSE = 'https://appian-eng.atlassian.net/browse/';

interface RowDoc {
  person: string;
  github_login?: string;
  run_ts: string;
  row_kind: 'matched' | 'jira_only' | 'pr_only';
  jira_key?: string;
  jira_type?: string;
  jira_status?: string;
  jira_summary?: string;
  pr_url?: string;
  pr_number?: number;
  pr_repo?: string;
  pr_branch?: string;
  pr_title?: string;
  pr_state?: string;
  pr_mergeable?: string;
  pr_needs_reply?: number;
  pr_ci_failures?: number;
  pr_ci_pending?: number;
  source?: string;
  possible_parent?: boolean;
  hint_key?: string;
}

interface PersonEntry {
  person: string;
  label: string;    // github_login, falling back to person
  runTs: string;    // latest run_ts for that person
  docs: RowDoc[];
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  loading = true;
  errorMsg = '';
  persons: PersonEntry[] = [];
  selectedPerson = '';

  matched: RowDoc[] = [];
  jiraOnly: RowDoc[] = [];
  prOnly: RowDoc[] = [];
  runTs = '';
  openPrCount = 0;

  constructor(private http: HttpClient, private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.fetch();
  }

  fetch(): void {
    this.loading = true;
    this.errorMsg = '';
    const body = { size: 500, query: { match_all: {} } };
    this.http.post<any>(`${ES_URL}/${INDEX}/_search`, body).subscribe({
      next: (res) => {
        const docs: RowDoc[] = (res?.hits?.hits ?? []).map((h: any) => h._source);
        this.persons = this.groupByPerson(docs);
        if (this.persons.length === 0) {
          this.errorMsg = 'No data yet — run the export skill.';
        } else {
          this.selectedPerson = this.persons[0].person;
          this.applySelection();
        }
        this.loading = false;
        this.cd.detectChanges();
      },
      error: (err) => {
        this.errorMsg = err?.status === 404
          ? 'Index not found — has the export run yet?'
          : `Fetch failed — connect to VPN and retry. (${err?.message ?? err})`;
        this.loading = false;
        this.cd.detectChanges();
      },
    });
  }

  private groupByPerson(docs: RowDoc[]): PersonEntry[] {
    const byPerson = new Map<string, RowDoc[]>();
    for (const d of docs) {
      if (!byPerson.has(d.person)) byPerson.set(d.person, []);
      byPerson.get(d.person)!.push(d);
    }
    const entries: PersonEntry[] = [];
    for (const [person, list] of byPerson) {
      const runTs = list.map((d) => d.run_ts).sort().at(-1) ?? '';
      entries.push({
        person,
        label: list.find((d) => d.github_login)?.github_login ?? person,
        runTs,
        docs: list,
      });
    }
    // Most recently exported person first (drives the default selection).
    entries.sort((a, b) => b.runTs.localeCompare(a.runTs));
    return entries;
  }

  applySelection(): void {
    const entry = this.persons.find((p) => p.person === this.selectedPerson);
    if (!entry) return;
    // Defensive: only the rows from the latest run of that person.
    const docs = entry.docs.filter((d) => d.run_ts === entry.runTs);
    const byKey = (a: RowDoc, b: RowDoc) =>
      (a.jira_key ?? '').localeCompare(b.jira_key ?? '');
    this.matched = docs.filter((d) => d.row_kind === 'matched').sort(byKey);
    this.jiraOnly = docs.filter((d) => d.row_kind === 'jira_only').sort(byKey);
    this.prOnly = docs
      .filter((d) => d.row_kind === 'pr_only')
      .sort((a, b) => (a.pr_number ?? 0) - (b.pr_number ?? 0));
    this.runTs = entry.runTs;
    this.openPrCount = docs.filter((d) => d.pr_state === 'OPEN').length;
  }

  jiraUrl(key: string | undefined): string {
    return key ? JIRA_BROWSE + key : '';
  }

  prLabel(d: RowDoc): string {
    if (!d.pr_number) return d.pr_url ?? '';
    return d.pr_repo === 'appian/ae' ? `#${d.pr_number}` : `fork#${d.pr_number}`;
  }

  statusClass(status: string | undefined): string {
    switch (status) {
      case 'Code Review': return 'c cr';
      case 'In Progress': return 'c ip';
      default: return 'c bl';
    }
  }

  prStateClass(state: string | undefined): string {
    if (state === 'OPEN') return 'c open';
    if (state === 'MERGED-OR-CLOSED') return 'c mrg';
    return 'c bl';
  }

  prStateLabel(state: string | undefined): string {
    return state === 'MERGED-OR-CLOSED' ? 'merged/closed' : (state ?? '');
  }

  mergeableIcon(value: string | undefined): string {
    if (value === 'MERGEABLE') return '✓';
    if (value === 'CONFLICTING') return '✗';
    if (value === 'UNKNOWN') return '?';
    return '';
  }

  mergeableClass(value: string | undefined): string {
    if (value === 'MERGEABLE') return 'm ok';
    if (value === 'CONFLICTING') return 'm bad';
    if (value === 'UNKNOWN') return 'm unk';
    return 'm';
  }

  needsReplyIcon(n: number | undefined): string {
    if (n === undefined || n === null) return '';
    return n > 0 ? `💬 ${n}` : '✓';
  }

  needsReplyClass(n: number | undefined): string {
    if (n === undefined || n === null) return 'r';
    return n > 0 ? 'r need' : 'r ok';
  }

  needsReplyTitle(n: number | undefined): string {
    if (n === undefined || n === null) return '';
    return n > 0
      ? `${n} unresolved thread(s) awaiting your reply`
      : 'no comments awaiting your reply';
  }

  ciIcon(failures: number | undefined, pending: number | undefined): string {
    if (failures === undefined || failures === null) return '';
    if (failures > 0) return `✗ ${failures}`;
    if (pending && pending > 0) return '…';
    return '✓';
  }

  ciClass(failures: number | undefined, pending: number | undefined): string {
    if (failures === undefined || failures === null) return 'ci';
    if (failures > 0) return 'ci bad';
    if (pending && pending > 0) return 'ci pend';
    return 'ci ok';
  }

  ciTitle(failures: number | undefined, pending: number | undefined): string {
    if (failures === undefined || failures === null) return '';
    if (failures > 0) return `${failures} failing CI check(s)`;
    if (pending && pending > 0) return `${pending} CI check(s) still running`;
    return 'all CI checks passing';
  }
}
