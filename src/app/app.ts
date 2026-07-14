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
  jira_reviewers?: string;
  pr_url?: string;
  pr_number?: number;
  pr_repo?: string;
  pr_branch?: string;
  pr_title?: string;
  pr_state?: string;
  pr_mergeable?: string;
  pr_needs_reply?: number;
  pr_needs_reply_from?: string;
  pr_ci_failures?: number;
  pr_ci_pending?: number;
  pr_ci_expected?: number;
  pr_approved_by?: string;
  pr_review_decision?: string;
  pr_behind?: number;
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
  doneNotClosed: RowDoc[] = [];
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
    // Matched shows live work only; a merged/closed PR on a still-open Jira
    // goes to its own "close the ticket?" section instead.
    this.matched = docs
      .filter((d) => d.row_kind === 'matched' && d.pr_state !== 'MERGED-OR-CLOSED')
      .sort(byKey);
    this.doneNotClosed = docs
      .filter((d) => d.row_kind === 'matched' && d.pr_state === 'MERGED-OR-CLOSED')
      .sort(byKey);
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
      ? `${n} comment(s)/thread(s) awaiting your reply`
      : 'no comments awaiting your reply';
  }

  ciIcon(failures: number | undefined, pending: number | undefined,
         expected: number | undefined): string {
    if (failures === undefined || failures === null) return '';
    const parts: string[] = [];
    if (failures > 0) parts.push(`✗ ${failures}`);
    if (expected && expected > 0) parts.push(`⏳ ${expected}`);
    if (parts.length) return parts.join('  ');
    if (pending && pending > 0) return '…';
    return '✓';
  }

  ciClass(failures: number | undefined, pending: number | undefined,
          expected: number | undefined): string {
    if (failures === undefined || failures === null) return 'ci';
    if (failures > 0) return 'ci bad';
    if (expected && expected > 0) return 'ci exp';
    if (pending && pending > 0) return 'ci pend';
    return 'ci ok';
  }

  ciTitle(failures: number | undefined, pending: number | undefined,
          expected: number | undefined): string {
    if (failures === undefined || failures === null) return '';
    const bits: string[] = [];
    if (failures > 0) bits.push(`${failures} failing check(s)`);
    if (expected && expected > 0) bits.push(`${expected} required check(s) not started yet`);
    if (pending && pending > 0) bits.push(`${pending} check(s) running`);
    return bits.length ? bits.join('; ') : 'all CI checks passing';
  }

  approvedIcon(approvedBy: string | undefined, decision: string | undefined): string {
    if (approvedBy) {
      const names = approvedBy.split(',');
      return names.length > 1 ? `✓ ${names[0]} +${names.length - 1}` : `✓ ${names[0]}`;
    }
    if (decision === 'CHANGES_REQUESTED') return '✗ changes';
    if (decision) return '— not yet';
    return '';
  }

  approvedClass(approvedBy: string | undefined, decision: string | undefined): string {
    if (approvedBy) return 'ap ok';
    if (decision === 'CHANGES_REQUESTED') return 'ap bad';
    if (decision) return 'ap none';
    return 'ap';
  }

  approvedTitle(approvedBy: string | undefined, decision: string | undefined): string {
    const bits: string[] = [];
    if (approvedBy) bits.push(`approved by ${approvedBy.split(',').join(', ')}`);
    if (decision) bits.push(`review decision: ${decision}`);
    return bits.join('; ');
  }

  reviewerIcon(r: string | undefined): string {
    return r ? `✓ ${r.split(',')[0]}` : '✗ brak reviewera';
  }

  reviewerClass(r: string | undefined): string {
    return r ? 'rv ok' : 'rv bad';
  }

  reviewerTitle(r: string | undefined): string {
    return r ? `Jira Reviewers: ${r}` : 'no Reviewers set on the Jira ticket — it will NOT appear on the review board (filter 34322)';
  }

  behindLabel(n: number | undefined): string {
    return n === undefined || n === null ? '' : String(n);
  }

  behindClass(n: number | undefined): string {
    if (n === undefined || n === null) return 'bh';
    if (n >= 30) return 'bh bad';
    if (n > 0) return 'bh warn';
    return 'bh ok';
  }

  behindTitle(n: number | undefined): string {
    return n === undefined || n === null
      ? '' : `${n} commit(s) behind the target branch`;
  }

  // run_ts is stored UTC as "YYYY-MM-DDTHH:MM:SSZ" -> "YYYY-MM-DD HH:MM UTC".
  formatExportTs(ts: string | undefined): string {
    if (!ts) return '';
    return ts.slice(0, 16).replace('T', ' ') + ' UTC';
  }
}
