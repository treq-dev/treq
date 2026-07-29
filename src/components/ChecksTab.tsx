import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	CircleDot,
	FileText,
	Loader2,
	Play,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import {
	isRepoTrusted,
	listWorkflowRuns,
	listWorkflows,
	runWorkflow,
	runWorkflowJob,
	trustRepo,
} from "../lib/api";
import type { JobResult, RunSummary, WorkflowInfo } from "../lib/api-types";
import { LogsBrowser } from "./LogsBrowser";

interface Props {
	repoPath: string;
	workspaceId: number;
	workspacePath: string;
	onSendToAgent?: (prompt: string) => void;
}

interface LogTarget {
	runId: number;
	jobId: string;
	stepIndex?: number;
}

function formatRunTime(ts: string): string {
	const parsed = new Date(ts);
	if (Number.isNaN(parsed.getTime())) return ts;
	return parsed.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function RunStatusIcon({ status }: { status: string }) {
	if (status === "passed") {
		return (
			<CheckCircle2
				data-testid="run-status-passed"
				className="h-4 w-4 text-green-500 shrink-0"
			/>
		);
	}
	if (status === "failed") {
		return (
			<XCircle
				data-testid="run-status-failed"
				className="h-4 w-4 text-red-500 shrink-0"
			/>
		);
	}
	return (
		<Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
	);
}

export function ChecksTab({
	repoPath,
	workspaceId,
	workspacePath,
	onSendToAgent,
}: Props) {
	const queryClient = useQueryClient();
	const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
	const [runningWorkflows, setRunningWorkflows] = useState<Set<string>>(
		new Set(),
	);
	const [jobResults, setJobResults] = useState<Record<string, JobResult>>({});
	const [logTarget, setLogTarget] = useState<LogTarget | null>(null);

	// Results and any open log view belong to the workspace they were run in.
	useEffect(() => {
		setJobResults({});
		setLogTarget(null);
	}, [workspaceId]);

	const { data: isTrusted, isLoading: trustLoading } = useQuery({
		queryKey: ["repo-trusted", repoPath],
		queryFn: () => isRepoTrusted(repoPath),
	});

	const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
		queryKey: ["workflows", repoPath],
		queryFn: () => listWorkflows(repoPath),
	});

	const jobKey = (filename: string, jobId: string) => `${filename}:${jobId}`;

	function invalidateRuns(filename: string) {
		queryClient.invalidateQueries({
			queryKey: ["workflow-runs", repoPath, workspaceId, filename],
		});
	}

	async function handleTrustRepo() {
		await trustRepo(repoPath);
		queryClient.invalidateQueries({ queryKey: ["repo-trusted", repoPath] });
	}

	async function handleRunJob(wf: WorkflowInfo, jobId: string) {
		const key = jobKey(wf.filename, jobId);
		setRunningJobs((prev) => new Set(prev).add(key));
		try {
			const result = await runWorkflowJob(
				repoPath,
				wf.filename,
				jobId,
				workspaceId,
				workspacePath,
			);
			setJobResults((prev) => ({ ...prev, [key]: result }));
		} finally {
			setRunningJobs((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
			invalidateRuns(wf.filename);
		}
	}

	async function handleRunWorkflow(wf: WorkflowInfo) {
		setRunningWorkflows((prev) => new Set(prev).add(wf.filename));
		try {
			const results = await runWorkflow(
				repoPath,
				wf.filename,
				workspaceId,
				workspacePath,
			);
			const updates: Record<string, JobResult> = {};
			for (const result of results) {
				updates[jobKey(wf.filename, result.job_id)] = result;
			}
			setJobResults((prev) => ({ ...prev, ...updates }));
		} finally {
			setRunningWorkflows((prev) => {
				const next = new Set(prev);
				next.delete(wf.filename);
				return next;
			});
			invalidateRuns(wf.filename);
		}
	}

	if (logTarget) {
		return (
			<LogsBrowser
				repoPath={repoPath}
				runId={logTarget.runId}
				jobId={logTarget.jobId}
				initialStepIndex={logTarget.stepIndex}
				onBack={() => setLogTarget(null)}
				onSendToAgent={onSendToAgent}
			/>
		);
	}

	if (trustLoading || workflowsLoading) {
		return (
			<div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Loading…
			</div>
		);
	}

	if (workflows.length === 0) {
		return (
			<div className="p-4 text-sm text-muted-foreground">
				No workflows found. Add YAML files to{" "}
				<code className="font-mono">.treq/workflows/</code> to get started.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 p-4">
			{!isTrusted && (
				<div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
					<div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
						<ShieldCheck className="h-4 w-4 shrink-0" />
						<span>
							Trust this repository to enable running workflow checks.
						</span>
					</div>
					<Button
						size="sm"
						variant="outline"
						className="ml-4 shrink-0"
						onClick={handleTrustRepo}
					>
						Trust Repository
					</Button>
				</div>
			)}

			{workflows.map((wf) => (
				<WorkflowCard
					key={wf.filename}
					workflow={wf}
					repoPath={repoPath}
					workspaceId={workspaceId}
					isTrusted={!!isTrusted}
					isRunningWorkflow={runningWorkflows.has(wf.filename)}
					runningJobs={runningJobs}
					jobResults={jobResults}
					jobKey={jobKey}
					onRunWorkflow={handleRunWorkflow}
					onRunJob={handleRunJob}
					onOpenLogs={setLogTarget}
				/>
			))}
		</div>
	);
}

interface CardProps {
	workflow: WorkflowInfo;
	repoPath: string;
	workspaceId: number;
	isTrusted: boolean;
	isRunningWorkflow: boolean;
	runningJobs: Set<string>;
	jobResults: Record<string, JobResult>;
	jobKey: (filename: string, jobId: string) => string;
	onRunWorkflow: (wf: WorkflowInfo) => void;
	onRunJob: (wf: WorkflowInfo, jobId: string) => void;
	onOpenLogs: (target: LogTarget) => void;
}

function WorkflowCard({
	workflow: wf,
	repoPath,
	workspaceId,
	isTrusted,
	isRunningWorkflow,
	runningJobs,
	jobResults,
	jobKey,
	onRunWorkflow,
	onRunJob,
	onOpenLogs,
}: CardProps) {
	const { data: runs = [] } = useQuery({
		queryKey: ["workflow-runs", repoPath, workspaceId, wf.filename],
		queryFn: () => listWorkflowRuns(repoPath, workspaceId, wf.filename),
	});

	const [latestRun]: (RunSummary | undefined)[] = runs;

	return (
		<div className="rounded-md border bg-card text-card-foreground">
			<div className="flex items-center justify-between px-4 py-3 border-b">
				<div>
					<div className="font-medium">{wf.name}</div>
					<div className="text-xs text-muted-foreground font-mono">
						{wf.filename}
					</div>
				</div>
				<Button
					size="sm"
					variant="outline"
					disabled={!isTrusted || isRunningWorkflow}
					onClick={() => onRunWorkflow(wf)}
				>
					{isRunningWorkflow ? (
						<Loader2 className="h-3 w-3 animate-spin mr-1" />
					) : (
						<Play className="h-3 w-3 mr-1" />
					)}
					Run All
				</Button>
			</div>

			<div className="divide-y">
				{wf.jobs.map((job) => {
					const key = jobKey(wf.filename, job.id);
					const isRunning = runningJobs.has(key);
					const result = jobResults[key];
					const runJob = latestRun?.jobs.find((j) => j.job_id === job.id);

					return (
						<div key={job.id} className="px-4 py-3">
							<div className="flex items-center justify-between mb-2">
								<span className="text-sm font-medium">{job.name}</span>
								<div className="flex items-center gap-1">
									{latestRun && runJob?.has_logs && (
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												onOpenLogs({ runId: latestRun.id, jobId: job.id })
											}
										>
											<FileText className="h-3 w-3 mr-1" />
											Logs
										</Button>
									)}
									<Button
										size="sm"
										variant="ghost"
										disabled={!isTrusted || isRunning || isRunningWorkflow}
										onClick={() => onRunJob(wf, job.id)}
									>
										{isRunning ? (
											<Loader2 className="h-3 w-3 animate-spin mr-1" />
										) : (
											<Play className="h-3 w-3 mr-1" />
										)}
										Run {job.name}
									</Button>
								</div>
							</div>

							<div className="flex flex-col gap-1 ml-2">
								{job.steps.map((step, idx) => {
									const stepResult = result?.steps[idx] ?? runJob?.steps[idx];
									const canOpenStepLogs = !!(latestRun && runJob?.has_logs);
									return (
										<button
											key={step.name}
											type="button"
											disabled={!canOpenStepLogs}
											onClick={() =>
												latestRun &&
												onOpenLogs({
													runId: latestRun.id,
													jobId: job.id,
													stepIndex: idx,
												})
											}
											className="flex items-center gap-2 text-sm text-left rounded px-1 -mx-1 enabled:hover:bg-muted disabled:cursor-default"
										>
											{stepResult === undefined ? (
												<CircleDot className="h-4 w-4 text-muted-foreground shrink-0" />
											) : stepResult.success ? (
												<CheckCircle2
													data-testid="step-result-pass"
													className="h-4 w-4 text-green-500 shrink-0"
												/>
											) : (
												<XCircle
													data-testid="step-result-fail"
													className="h-4 w-4 text-red-500 shrink-0"
												/>
											)}
											<span>{step.name}</span>
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>

			{runs.length > 0 && (
				<div className="border-t">
					<div className="px-4 py-2 text-xs font-medium text-muted-foreground">
						Run history
					</div>
					<div className="divide-y">
						{runs.map((run) => (
							<div
								key={run.id}
								data-testid="run-history-item"
								className="flex items-center justify-between px-4 py-2 text-sm"
							>
								<div className="flex items-center gap-2 min-w-0">
									<RunStatusIcon status={run.status} />
									<span className="font-mono text-xs">#{run.id}</span>
									<span className="text-muted-foreground text-xs">
										{formatRunTime(run.started_at)}
									</span>
								</div>
								<div className="flex items-center gap-1">
									{run.jobs
										.filter((j) => j.has_logs)
										.map((j) => (
											<Button
												key={j.job_id}
												size="sm"
												variant="ghost"
												onClick={() =>
													onOpenLogs({ runId: run.id, jobId: j.job_id })
												}
											>
												<FileText className="h-3 w-3 mr-1" />
												{j.job_id}
											</Button>
										))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
