import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Calendar, Clock } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useTranslation, useLocale } from "@/i18n";

interface APIKey {
	id: string;
	name: string;
	description?: string;
	key_preview: string;
	created_at: string;
	last_used?: string;
}

interface APIKeyTableProps {
	refreshTrigger: number;
	onKeyChange: () => void;
}

export function APIKeyTable({ refreshTrigger, onKeyChange }: APIKeyTableProps) {
	const { t } = useTranslation();
	const locale = useLocale();
	const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const { getAuthHeaders } = useAuth();

	useEffect(() => {
		const fetchAPIKeys = async () => {
			try {
				const response = await fetch("/api/v1/api-keys/", {
					headers: getAuthHeaders(),
				});

				if (response.ok) {
					const data = await response.json();
					setApiKeys(data.api_keys || []);
				} else {
					console.error("Failed to fetch API keys");
					setApiKeys([]);
				}
			} catch (error) {
				console.error("Error fetching API keys:", error);
				setApiKeys([]);
			} finally {
				setLoading(false);
			}
		};

		fetchAPIKeys();
	}, [refreshTrigger, getAuthHeaders]);

	const handleDelete = async (id: string) => {
		if (!confirm(t('settings.apikeys.table.deleteConfirm'))) {
			return;
		}

		setDeletingId(id);
		try {
			const response = await fetch(`/api/v1/api-keys/${id}`, {
				method: "DELETE",
				headers: getAuthHeaders(),
			});

			if (response.ok) {
				onKeyChange();
			} else {
				console.error("Failed to delete API key");
			}
		} catch (error) {
			console.error("Error deleting API key:", error);
		} finally {
			setDeletingId(null);
		}
	};

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleDateString(locale, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	const formatDateTime = (dateString: string) => {
		return new Date(dateString).toLocaleString(locale, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32">
				<div className="text-carbon-500 dark:text-carbon-400">{t('settings.apikeys.table.loading')}</div>
			</div>
		);
	}

	if (apiKeys.length === 0) {
		return (
			<div className="text-center py-8">
				<div className="text-[var(--text-secondary)] mb-2">
					{t('settings.apikeys.table.empty')}
				</div>
				<div className="text-sm text-[var(--text-tertiary)]">
					{t('settings.apikeys.table.emptyDesc')}
				</div>
			</div>
		);
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full">
				<thead>
					<tr className="border-b border-carbon-200 dark:border-carbon-600">
						<th className="text-left py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.name')}
						</th>
						<th className="hidden sm:table-cell text-left py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.description')}
						</th>
						<th className="hidden sm:table-cell text-left py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.keyPreview')}
						</th>
						<th className="hidden sm:table-cell text-left py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.created')}
						</th>
						<th className="hidden sm:table-cell text-left py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.lastUsed')}
						</th>
						<th className="text-right py-2 px-2 sm:py-3 sm:px-4 font-medium text-[var(--text-secondary)]">
							{t('settings.apikeys.table.actions')}
						</th>
					</tr>
				</thead>
				<tbody>
					{apiKeys.map((apiKey) => (
						<tr
							key={apiKey.id}
							className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-main)]/30"
						>
							<td className="py-2 px-2 sm:py-3 sm:px-4">
								<div className="font-medium text-carbon-900 dark:text-carbon-100">
									{apiKey.name}
								</div>
							</td>
							<td className="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-4">
								<div className="text-sm text-carbon-600 dark:text-carbon-400">
									{apiKey.description || t('settings.apikeys.table.noDescription')}
								</div>
							</td>
							<td className="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-4">
								<div className="font-mono text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2 py-1 rounded">
									{apiKey.key_preview}
								</div>
							</td>
							<td className="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-4">
								<div className="flex items-center text-sm text-carbon-600 dark:text-carbon-400">
									<Calendar className="h-4 w-4 mr-1" />
									{formatDate(apiKey.created_at)}
								</div>
							</td>
							<td className="hidden sm:table-cell py-2 px-2 sm:py-3 sm:px-4">
								<div className="flex items-center text-sm text-carbon-600 dark:text-carbon-400">
									{apiKey.last_used ? (
										<>
											<Clock className="h-4 w-4 mr-1" />
											{formatDateTime(apiKey.last_used)}
										</>
									) : (
										t('settings.apikeys.table.never')
									)}
								</div>
							</td>
							<td className="py-2 px-2 sm:py-3 sm:px-4 text-right">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => handleDelete(apiKey.id)}
									disabled={deletingId === apiKey.id}
									className="text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error)]/10"
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
