"""
JobFinder -- a desktop dashboard wrapping the scraper scripts in this folder
behind a proper UI, so you don't need a terminal to use them.

Run it with:
    python jobfinder_gui.py
or just double-click "Run JobFinder.bat" in this folder.
"""

import json
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox

import customtkinter as ctk

try:
    import requests
except ImportError:
    requests = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON = sys.executable

# ---- palette -----------------------------------------------------------
BG = "#0f1420"
SIDEBAR = "#131a2b"
CARD = "#161e33"
CARD_BORDER = "#232d47"
ACCENT = "#3b82f6"
ACCENT_HOVER = "#2563eb"
TEXT_MAIN = "#e6e9f0"
TEXT_MUTED = "#8b94ab"
GOOD = "#22c55e"
WARN = "#f59e0b"
BAD = "#ef4444"
LOG_BG = "#0a0e18"

ctk.set_appearance_mode("dark")


def load_dotenv(path):
    env = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    return env


def get_firecrawl_credits():
    env = load_dotenv(os.path.join(SCRIPT_DIR, ".env"))
    key = env.get("FIRECRAWL_API_KEY") or os.environ.get("FIRECRAWL_API_KEY")
    if not key or requests is None:
        return None
    try:
        resp = requests.get(
            "https://api.firecrawl.dev/v1/team/credit-usage",
            headers={"Authorization": f"Bearer {key}"},
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            return data.get("remaining_credits"), data.get("plan_credits")
    except Exception:
        pass
    return None


def count_xlsx_rows(path):
    if not os.path.exists(path):
        return None
    try:
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True)
        ws = wb.active
        return max(ws.max_row - 1, 0)
    except Exception:
        return None


def file_mtime_str(path):
    if not os.path.exists(path):
        return "never"
    t = time.localtime(os.path.getmtime(path))
    return time.strftime("%Y-%m-%d %H:%M", t)


# ---- reusable widgets ----------------------------------------------------


class Card(ctk.CTkFrame):
    def __init__(self, parent, **kwargs):
        super().__init__(
            parent,
            fg_color=CARD,
            border_color=CARD_BORDER,
            border_width=1,
            corner_radius=10,
            **kwargs,
        )


class StatusBadge(ctk.CTkLabel):
    def __init__(self, parent):
        super().__init__(
            parent,
            text="IDLE",
            text_color="#0f1420",
            fg_color=TEXT_MUTED,
            corner_radius=6,
            width=90,
            height=24,
            font=ctk.CTkFont(size=11, weight="bold"),
        )

    def set_state(self, state):
        colors = {"IDLE": TEXT_MUTED, "RUNNING": WARN, "DONE": GOOD, "FAILED": BAD}
        self.configure(text=state, fg_color=colors.get(state, TEXT_MUTED))


class KpiCard(Card):
    def __init__(self, parent, label, value_getter):
        super().__init__(parent, height=88)
        self.value_getter = value_getter
        self.grid_propagate(False)
        self.label_text = ctk.CTkLabel(
            self, text=label, text_color=TEXT_MUTED, font=ctk.CTkFont(size=12), anchor="w"
        )
        self.label_text.pack(fill="x", padx=16, pady=(14, 0))
        self.value_text = ctk.CTkLabel(
            self, text="--", text_color=TEXT_MAIN, font=ctk.CTkFont(size=22, weight="bold"), anchor="w"
        )
        self.value_text.pack(fill="x", padx=16, pady=(0, 12))
        self.refresh()

    def refresh(self):
        self.value_text.configure(text=self.value_getter())


# ---- runner page (used by DailyRemote / HealthJobsUK / Sponsorship / Export) --


class RunnerPage(ctk.CTkFrame):
    def __init__(self, parent, title, description, fields, run_button_text, build_cmd, output_file_getter, cost_note=None):
        super().__init__(parent, fg_color="transparent")
        self.build_cmd = build_cmd
        self.output_file_getter = output_file_getter
        self.field_vars = {}
        self.proc = None
        self.log_queue = queue.Queue()

        ctk.CTkLabel(self, text=title, font=ctk.CTkFont(size=20, weight="bold"), text_color=TEXT_MAIN).pack(
            anchor="w", pady=(0, 4)
        )
        ctk.CTkLabel(
            self, text=description, font=ctk.CTkFont(size=13), text_color=TEXT_MUTED, wraplength=760, justify="left"
        ).pack(anchor="w", pady=(0, 4))
        if cost_note:
            ctk.CTkLabel(
                self, text=cost_note, font=ctk.CTkFont(size=12, weight="bold"), text_color=WARN
            ).pack(anchor="w", pady=(2, 14))
        else:
            ctk.CTkLabel(self, text="", font=ctk.CTkFont(size=4)).pack(pady=(2, 6))

        control_card = Card(self)
        control_card.pack(fill="x", pady=(0, 14))
        inner = ctk.CTkFrame(control_card, fg_color="transparent")
        inner.pack(fill="x", padx=18, pady=16)

        for key, label, default in fields:
            row = ctk.CTkFrame(inner, fg_color="transparent")
            row.pack(fill="x", pady=4)
            ctk.CTkLabel(row, text=label, width=170, anchor="w", text_color=TEXT_MUTED).pack(side="left")
            var = tk.StringVar(value=default)
            self.field_vars[key] = var
            ctk.CTkEntry(row, textvariable=var, width=260, fg_color=BG, border_color=CARD_BORDER).pack(
                side="left"
            )

        btn_row = ctk.CTkFrame(inner, fg_color="transparent")
        btn_row.pack(fill="x", pady=(12, 0))
        self.run_btn = ctk.CTkButton(
            btn_row,
            text=run_button_text,
            command=self.start_run,
            fg_color=ACCENT,
            hover_color=ACCENT_HOVER,
            corner_radius=8,
            height=36,
            width=180,
        )
        self.run_btn.pack(side="left")
        self.open_btn = ctk.CTkButton(
            btn_row,
            text="Open result file",
            command=self.open_result,
            fg_color="transparent",
            border_width=1,
            border_color=CARD_BORDER,
            hover_color=CARD_BORDER,
            text_color=TEXT_MAIN,
            corner_radius=8,
            height=36,
            width=160,
        )
        self.open_btn.pack(side="left", padx=(10, 0))
        self.status = StatusBadge(btn_row)
        self.status.pack(side="left", padx=(14, 0))

        log_card = Card(self)
        log_card.pack(fill="both", expand=True)
        ctk.CTkLabel(
            log_card, text="LIVE OUTPUT", text_color=TEXT_MUTED, font=ctk.CTkFont(size=11, weight="bold")
        ).pack(anchor="w", padx=16, pady=(12, 4))
        self.log = ctk.CTkTextbox(
            log_card,
            fg_color=LOG_BG,
            text_color="#9fe3a0",
            font=ctk.CTkFont(family="Consolas", size=12),
            corner_radius=6,
        )
        self.log.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.log.configure(state="disabled")

        self.after(150, self._drain_log_queue)

    def _append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _drain_log_queue(self):
        try:
            while True:
                self._append_log(self.log_queue.get_nowait())
        except queue.Empty:
            pass
        self.after(150, self._drain_log_queue)

    def start_run(self):
        if self.proc is not None:
            messagebox.showinfo("Already running", "This job is already running.")
            return
        try:
            cmd = self.build_cmd(self.field_vars)
        except ValueError as exc:
            messagebox.showerror("Invalid input", str(exc))
            return

        self._append_log(f"\n$ {' '.join(cmd)}\n")
        self.run_btn.configure(state="disabled")
        self.status.set_state("RUNNING")

        def worker():
            self.proc = subprocess.Popen(
                cmd,
                cwd=SCRIPT_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            for line in self.proc.stdout:
                self.log_queue.put(line)
            self.proc.wait()
            code = self.proc.returncode
            self.proc = None
            self.log_queue.put(f"\n[exit code {code}]\n")
            self.after(0, lambda: self._on_finished(code))

        threading.Thread(target=worker, daemon=True).start()

    def _on_finished(self, code):
        self.run_btn.configure(state="normal")
        self.status.set_state("DONE" if code == 0 else "FAILED")

    def open_result(self):
        path = self.output_file_getter()
        if not path or not os.path.exists(path):
            messagebox.showinfo("Not found", f"Couldn't find:\n{path}\n\nRun the scrape first.")
            return
        os.startfile(path)


# ---- overview page ---------------------------------------------------------


class OverviewPage(ctk.CTkFrame):
    def __init__(self, parent):
        super().__init__(parent, fg_color="transparent")
        ctk.CTkLabel(self, text="Overview", font=ctk.CTkFont(size=20, weight="bold"), text_color=TEXT_MAIN).pack(
            anchor="w", pady=(0, 4)
        )
        ctk.CTkLabel(
            self,
            text="Snapshot of your scraped data and remaining Firecrawl credit balance.",
            font=ctk.CTkFont(size=13),
            text_color=TEXT_MUTED,
        ).pack(anchor="w", pady=(0, 16))

        grid = ctk.CTkFrame(self, fg_color="transparent")
        grid.pack(fill="x")
        grid.grid_columnconfigure((0, 1, 2), weight=1, uniform="kpi")

        self.kpis = [
            KpiCard(grid, "DailyRemote jobs", self._dr_count),
            KpiCard(grid, "HealthJobsUK jobs", self._hju_count),
            KpiCard(grid, "Firecrawl credits left", self._credits),
        ]
        for i, kpi in enumerate(self.kpis):
            kpi.grid(row=0, column=i, sticky="ew", padx=(0 if i == 0 else 8, 0))

        info_card = Card(self)
        info_card.pack(fill="x", pady=(16, 0))
        inner = ctk.CTkFrame(info_card, fg_color="transparent")
        inner.pack(fill="x", padx=18, pady=16)
        self.dr_updated = ctk.CTkLabel(inner, text="", text_color=TEXT_MUTED, anchor="w")
        self.dr_updated.pack(fill="x")
        self.hju_updated = ctk.CTkLabel(inner, text="", text_color=TEXT_MUTED, anchor="w")
        self.hju_updated.pack(fill="x", pady=(4, 0))

        refresh_btn = ctk.CTkButton(
            self, text="Refresh", command=self.refresh_all, fg_color=ACCENT, hover_color=ACCENT_HOVER, width=120
        )
        refresh_btn.pack(anchor="w", pady=(16, 0))

        self.refresh_all()

    def _dr_count(self):
        n = count_xlsx_rows(os.path.join(SCRIPT_DIR, "dailyremote_jobs.xlsx"))
        return str(n) if n is not None else "--"

    def _hju_count(self):
        n = count_xlsx_rows(os.path.join(SCRIPT_DIR, "healthjobsuk_jobs.xlsx"))
        return str(n) if n is not None else "--"

    def _credits(self):
        result = get_firecrawl_credits()
        if not result:
            return "--"
        remaining, plan = result
        return f"{remaining} / {plan}"

    def refresh_all(self):
        for kpi in self.kpis:
            kpi.refresh()
        self.dr_updated.configure(
            text=f"DailyRemote last updated: {file_mtime_str(os.path.join(SCRIPT_DIR, 'dailyremote_jobs.xlsx'))}"
        )
        self.hju_updated.configure(
            text=f"HealthJobsUK last updated: {file_mtime_str(os.path.join(SCRIPT_DIR, 'healthjobsuk_jobs.xlsx'))}"
        )


# ---- command builders --------------------------------------------------


def build_dailyremote_cmd(fields):
    target = fields["target"].get().strip()
    search = fields["search"].get().strip()
    if not target.isdigit():
        raise ValueError("Target must be a whole number.")
    cmd = [PYTHON, "scrape_dailyremote.py", "--target", target]
    if search:
        cmd += ["--search", search]
    return cmd


def build_hju_listing_cmd(fields):
    target = fields["target"].get().strip()
    category = fields["category"].get().strip() or "Nursing_and_Midwifery"
    if not target.isdigit():
        raise ValueError("Target must be a whole number.")
    return [PYTHON, "scrape_healthjobsuk.py", "--target", target, "--category", category]


def build_custom_cmd(fields):
    url = fields["url"].get().strip()
    pages = fields["pages"].get().strip()
    page_param = fields["page_param"].get().strip() or "page"
    if not url:
        raise ValueError("Paste a job listings URL first.")
    if not pages.isdigit() or int(pages) < 1:
        raise ValueError("Pages must be a whole number of 1 or more.")
    cmd = [PYTHON, "scrape_custom.py", "--url", url, "--pages", pages, "--page-param", page_param]
    return cmd


def build_sponsorship_cmd(fields):
    return [PYTHON, "add_sponsorship.py"]


def build_export_cmd(fields):
    return [PYTHON, "export_healthjobsuk_excel.py"]


# ---- app shell ------------------------------------------------------------


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("JobFinder")
        self.geometry("980x680")
        self.configure(fg_color=BG)
        self.minsize(860, 600)

        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # --- sidebar ---
        sidebar = ctk.CTkFrame(self, fg_color=SIDEBAR, width=210, corner_radius=0)
        sidebar.grid(row=0, column=0, sticky="nsw")
        sidebar.grid_propagate(False)

        brand = ctk.CTkFrame(sidebar, fg_color="transparent")
        brand.pack(fill="x", padx=20, pady=(24, 30))
        ctk.CTkLabel(
            brand, text="JobFinder", font=ctk.CTkFont(size=18, weight="bold"), text_color=TEXT_MAIN
        ).pack(anchor="w")
        ctk.CTkLabel(
            brand, text="Job scraping console", font=ctk.CTkFont(size=11), text_color=TEXT_MUTED
        ).pack(anchor="w")

        self.nav_buttons = {}
        nav_items = [
            ("overview", "Overview"),
            ("dailyremote", "DailyRemote"),
            ("healthjobsuk", "HealthJobsUK"),
            ("sponsorship", "Sponsorship"),
            ("export", "Rebuild Excel"),
            ("custom", "Custom URL"),
        ]
        for key, label in nav_items:
            btn = ctk.CTkButton(
                sidebar,
                text=label,
                anchor="w",
                fg_color="transparent",
                hover_color=CARD,
                text_color=TEXT_MUTED,
                corner_radius=6,
                height=38,
                command=lambda k=key: self.show_page(k),
            )
            btn.pack(fill="x", padx=12, pady=2)
            self.nav_buttons[key] = btn

        # --- content area ---
        content = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        content.grid(row=0, column=1, sticky="nsew")
        content.grid_columnconfigure(0, weight=1)
        content.grid_rowconfigure(0, weight=1)

        self.pages = {}
        self.pages["overview"] = OverviewPage(content)
        self.pages["dailyremote"] = RunnerPage(
            content,
            title="DailyRemote",
            description=(
                "Scrapes the newest remote job listings from dailyremote.com into an Excel file. "
                "Runs as a plain script against the public site."
            ),
            fields=[("target", "Number of jobs", "100"), ("search", "Search keyword (optional)", "")],
            run_button_text="Scrape DailyRemote",
            build_cmd=build_dailyremote_cmd,
            output_file_getter=lambda: os.path.join(SCRIPT_DIR, "dailyremote_jobs.xlsx"),
            cost_note="No API key required -- free to run anytime.",
        )
        self.pages["healthjobsuk"] = RunnerPage(
            content,
            title="HealthJobsUK -- Scrape Listings",
            description=(
                "Scrapes NHS/health job listings from healthjobsuk.com. This site sits behind a "
                "Cloudflare bot-check, so it uses your Firecrawl API key from .env."
            ),
            fields=[("target", "Number of jobs", "100"), ("category", "Category", "Nursing_and_Midwifery")],
            run_button_text="Scrape HealthJobsUK",
            build_cmd=build_hju_listing_cmd,
            output_file_getter=lambda: os.path.join(SCRIPT_DIR, "healthjobsuk_jobs.xlsx"),
            cost_note="Uses Firecrawl credits: ~9 credits per page of ~50 jobs.",
        )
        self.pages["sponsorship"] = RunnerPage(
            content,
            title="HealthJobsUK -- Add Sponsorship Info",
            description=(
                "Best-effort read of visa-sponsorship language on each already-scraped job's detail "
                "page (there's no structured field for it on the site). Run 'HealthJobsUK' first."
            ),
            fields=[],
            run_button_text="Add Sponsorship Info",
            build_cmd=build_sponsorship_cmd,
            output_file_getter=lambda: os.path.join(SCRIPT_DIR, "healthjobsuk_merged.json"),
            cost_note="Uses Firecrawl credits: ~5 credits per job, skips jobs already done.",
        )
        self.pages["export"] = RunnerPage(
            content,
            title="HealthJobsUK -- Rebuild Excel",
            description=(
                "Rebuilds healthjobsuk_jobs.xlsx from current data, including sponsorship info. "
                "Close the Excel file first if it's open."
            ),
            fields=[],
            run_button_text="Rebuild Excel",
            build_cmd=build_export_cmd,
            output_file_getter=lambda: os.path.join(SCRIPT_DIR, "healthjobsuk_jobs.xlsx"),
            cost_note=None,
        )

        self.pages["custom"] = RunnerPage(
            content,
            title="Custom URL",
            description=(
                "Paste any job listings page and this will use Firecrawl's structured extraction "
                "to pull out job cards (title, company, location, job type, salary, URL). This "
                "adapts to different site layouts, unlike the DailyRemote scraper which is hardcoded "
                "to that one site's HTML -- but field coverage will vary by site, and pagination is "
                "NOT auto-detected. Tell it the query-parameter name your target site uses for page "
                "numbers (e.g. \"page\", \"_pg\", \"p\"); if that's wrong, page 2 will come back empty "
                "and it'll stop rather than waste credits guessing further."
            ),
            fields=[
                ("url", "Job listings URL", ""),
                ("pages", "Pages to fetch", "1"),
                ("page_param", "Pagination query param", "page"),
            ],
            run_button_text="Scrape URL",
            build_cmd=build_custom_cmd,
            output_file_getter=lambda: os.path.join(SCRIPT_DIR, "custom_jobs.xlsx"),
            cost_note="Uses Firecrawl credits: ~9 credits per page.",
        )

        for page in self.pages.values():
            page.grid(row=0, column=0, sticky="nsew", padx=28, pady=24)

        self.show_page("overview")

    def show_page(self, key):
        for k, btn in self.nav_buttons.items():
            btn.configure(fg_color=CARD if k == key else "transparent", text_color=TEXT_MAIN if k == key else TEXT_MUTED)
        self.pages[key].tkraise()
        if key == "overview":
            self.pages["overview"].refresh_all()


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
