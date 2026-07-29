import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	CircleDot,
	Loader2,
	Play,
	XCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { listWorkflows, runWorkflow, runWorkflowJob } from "../lib/api";
import type { JobResult, WorkflowInfo } from "../lib/api-types";

interface Props {
	repoPath: string;
	workspaceId: number;
	workspacePath: string;
}

export function ChecksTab({ repoPath, workspaceId, workspacePath }: Props) {
	const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
	const [runningWorkflows, setRunningWorkflows] = useState<Set<string>>(
		new Set(),
	);
	const [jobResults, setJobResults] = useState<Record<string, JobResult>>({});

	const { data: workflows = [], isLoading } = useQuery({
		queryKey: ["workflows", repoPath],
		queryFn: () => listWorkflows(repoPath),
	});

	const jobKey = (filename: string, jobId: string) => `${filename}:${jobId}`;

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
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Loading workflows…
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
			{workflows.map((wf) => (
				<div
					key={wf.filename}
					className="rounded-md border bg-card text-card-foreground"
				>
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
							disabled={runningWorkflows.has(wf.filename)}
							onClick={() => handleRunWorkflow(wf)}
						>
							{runningWorkflows.has(wf.filename) ? (
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

							return (
								<div key={job.id} className="px-4 py-3">
									<div className="flex items-center justify-between mb-2">
										<span className="text-sm font-medium">{job.name}</span>
										<Button
											size="sm"
											variant="ghost"
											disabled={isRunning || runningWorkflows.has(wf.filename)}
											onClick={() => handleRunJob(wf, job.id)}
										>
											{isRunning ? (
												<Loader2 className="h-3 w-3 animate-spin mr-1" />
											) : (
												<Play className="h-3 w-3 mr-1" />
											)}
											Run {job.name}
										</Button>
									</div>

									<div className="flex flex-col gap-1 ml-2">
										{job.steps.map((step, idx) => {
											const stepResult = result?.steps[idx];
											return (
												<div
													key={step.name}
													className="flex items-center gap-2 text-sm"
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
												</div>
											);
										})}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
