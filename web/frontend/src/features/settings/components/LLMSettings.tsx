import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Key, Globe, CheckCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useTranslation } from "@/i18n";

interface LLMConfig {
	id?: number;
	provider: string;
	base_url?: string;
	openai_base_url?: string;
	has_api_key?: boolean;
	is_active: boolean;
	created_at?: string;
	updated_at?: string;
}

export function LLMSettings() {
	const { t } = useTranslation();
	const [config, setConfig] = useState<LLMConfig>({
		provider: "ollama",
		is_active: false,
	});
	const [baseUrl, setBaseUrl] = useState("");
	const [openAIBaseUrl, setOpenAIBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const { getAuthHeaders } = useAuth();

	useEffect(() => {
		const fetchConfig = async () => {
			try {
				const response = await fetch("/api/v1/llm/config", {
					headers: getAuthHeaders(),
				});

				if (response.ok) {
					const data = await response.json();
					setConfig(data);
					setBaseUrl(data.base_url || "");
					setOpenAIBaseUrl(data.openai_base_url || "");
					// Don't set API key from response for security
				} else if (response.status !== 404) {
					console.error("Failed to fetch LLM config");
				}
			} catch (error) {
				console.error("Error fetching LLM config:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchConfig();
	}, [getAuthHeaders]);

	const handleSave = async () => {
		setSaving(true);
		setMessage(null);

		const payload = {
			provider: config.provider,
			is_active: true, // Always set to active when saving
			...(config.provider === "ollama" && { base_url: baseUrl }),
			...(config.provider === "openai" && {
				api_key: apiKey,
				openai_base_url: openAIBaseUrl
			}),
		};

		try {
			const response = await fetch("/api/v1/llm/config", {
				method: "POST",
				headers: {
					...getAuthHeaders(),
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (response.ok) {
				const data = await response.json();
				setConfig(data);
				setMessage({ type: "success", text: t('settings.llm.saved') });
				// Clear the API key field after saving
				if (config.provider === "openai") {
					setApiKey("");
				}
			} else {
				const errorData = await response.json();
				setMessage({ type: "error", text: errorData.error || t('settings.llm.saveFailed') });
			}
		} catch (error) {
			console.error("Error saving LLM config:", error);
			setMessage({ type: "error", text: t('settings.llm.saveFailedRetry') });
		} finally {
			setSaving(false);
		}
	};

	const isFormValid = () => {
		if (config.provider === "ollama") {
			return baseUrl.trim() !== "";
		}
		if (config.provider === "openai") {
			return apiKey.trim() !== "" || config.has_api_key;
		}
		return false;
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32">
				<div className="text-[var(--text-tertiary)]">{t('settings.llm.loading')}</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="bg-[var(--bg-main)]/50 border border-[var(--border-subtle)] rounded-[var(--radius-card)] p-4 sm:p-6 shadow-sm">
				<div className="mb-4 sm:mb-6">
					<h3 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
						<Bot className="h-5 w-5 text-[var(--brand-solid)]" />
						{t('settings.llm.title')}
					</h3>
					<p className="text-sm text-[var(--text-secondary)] mt-1">
						{t('settings.llm.description')}
					</p>
				</div>

				{message && (
					<div className={`mb-4 sm:mb-6 p-3 sm:p-4 rounded-lg flex items-center gap-2 ${message.type === "success"
						? "bg-[var(--success-translucent)] text-[var(--success-solid)]"
						: "bg-[var(--error)]/10 text-[var(--error)]"
						}`}>
						{message.type === "success" ? (
							<CheckCircle className="h-4 w-4" />
						) : (
							<AlertCircle className="h-4 w-4" />
						)}
						{message.text}
					</div>
				)}

				<div className="space-y-6">
					{/* Provider Selection */}
					<div>
						<Label className="text-base font-medium">{t('settings.llm.providerLabel')}</Label>
						<p className="text-sm text-carbon-600 dark:text-carbon-400 mb-3">
							{t('settings.llm.providerDesc')}
						</p>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<label htmlFor="ollama">
								<Card className={`cursor-pointer transition-all ${config.provider === "ollama"
									? "border-[var(--brand-solid)] bg-[var(--brand-light)] shadow-md transform scale-[1.01]"
									: "bg-[var(--bg-main)] hover:bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:shadow-sm"
									}`}>
									<CardHeader className="pb-2">
										<div className="flex items-center space-x-2">
											<input
												type="radio"
												id="ollama"
												name="provider"
												value="ollama"
												checked={config.provider === "ollama"}
												onChange={(e) => setConfig({ ...config, provider: e.target.value })}
												className="h-4 w-4 text-[var(--brand-solid)] focus:ring-[var(--brand-solid)] accent-[var(--brand-solid)]"
											/>
											<Bot className="h-5 w-5 text-[var(--text-primary)]" />
											<CardTitle className="text-base text-[var(--text-primary)]">{t('settings.llm.ollama')}</CardTitle>
										</div>
									</CardHeader>
									<CardContent>
										<CardDescription className="text-[var(--text-secondary)]">
											{t('settings.llm.ollamaDesc')}
										</CardDescription>
									</CardContent>
								</Card>
							</label>

							<label htmlFor="openai">
								<Card className={`cursor-pointer transition-all ${config.provider === "openai"
									? "border-[var(--brand-solid)] bg-[var(--brand-light)] shadow-md transform scale-[1.01]"
									: "bg-[var(--bg-main)] hover:bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:shadow-sm"
									}`}>
									<CardHeader className="pb-2">
										<div className="flex items-center space-x-2">
											<input
												type="radio"
												id="openai"
												name="provider"
												value="openai"
												checked={config.provider === "openai"}
												onChange={(e) => setConfig({ ...config, provider: e.target.value })}
												className="h-4 w-4 text-[var(--brand-solid)] focus:ring-[var(--brand-solid)] accent-[var(--brand-solid)]"
											/>
											<Globe className="h-5 w-5 text-[var(--text-primary)]" />
											<CardTitle className="text-base text-[var(--text-primary)]">{t('settings.llm.openai')}</CardTitle>
										</div>
									</CardHeader>
									<CardContent>
										<CardDescription className="text-[var(--text-secondary)]">
											{t('settings.llm.openaiDesc')}
										</CardDescription>
									</CardContent>
								</Card>
							</label>
						</div>
					</div>

					{/* Configuration Fields */}
					<div className="space-y-4">
						{config.provider === "ollama" && (
							<div>
								<Label htmlFor="baseUrl" className="text-[var(--text-primary)]">{t('settings.llm.ollamaUrl')}</Label>
								<Input
									id="baseUrl"
									type="url"
									placeholder={t('settings.llm.ollamaUrlPlaceholder')}
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									className="mt-1 bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--brand-solid)]"
								/>
								<p className="text-xs text-[var(--text-tertiary)] mt-1">
									{t('settings.llm.ollamaUrlDesc')}
								</p>
							</div>
						)}

						{config.provider === "openai" && (
							<div className="space-y-4">
								<div>
									<Label htmlFor="apiKey" className="flex items-center gap-2 text-[var(--text-primary)]">
										<Key className="h-4 w-4 text-[var(--text-tertiary)]" />
										{t('settings.llm.openaiKey')}
										{config.has_api_key && (
											<span className="text-xs bg-[var(--success-translucent)] text-[var(--success-solid)] px-2 py-1 rounded">
												{t('settings.llm.alreadyConfigured')}
											</span>
										)}
									</Label>
									<Input
										id="apiKey"
										type="password"
										placeholder={config.has_api_key ? t('settings.llm.enterNewKey') : t('settings.llm.openaiKeyPlaceholder')}
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										className="mt-1 bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--brand-solid)]"
									/>
									<p className="text-xs text-[var(--text-tertiary)] mt-1">
										{t('settings.llm.openaiKeyDesc')}
									</p>
								</div>

								<div>
									<Label htmlFor="openAIBaseUrl" className="text-[var(--text-primary)]">{t('settings.llm.openaiUrl')}</Label>
									<Input
										id="openAIBaseUrl"
										type="url"
										placeholder={t('settings.llm.openaiUrlPlaceholder')}
										value={openAIBaseUrl}
										onChange={(e) => setOpenAIBaseUrl(e.target.value)}
										className="mt-1 bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--brand-solid)]"
									/>
									<p className="text-xs text-[var(--text-tertiary)] mt-1">
										{t('settings.llm.openaiUrlCustomPlaceholder')}
									</p>
								</div>
							</div>
						)}
					</div>

					{/* Status */}
					{config.id && (
						<div className="bg-[var(--bg-main)]/50 rounded-lg p-4 border border-[var(--border-subtle)]">
							<h4 className="font-medium text-[var(--text-primary)] mb-2">{t('settings.llm.status')}</h4>
							<div className="flex items-center gap-2">
								{config.is_active ? (
									<>
										<CheckCircle className="h-4 w-4 text-[var(--success-solid)]" />
										<span className="text-sm text-[var(--success-solid)]">
											{t('settings.llm.activeConfig').replace('{provider}', config.provider)}
										</span>
									</>
								) : (
									<>
										<AlertCircle className="h-4 w-4 text-[var(--warning-solid)]" />
										<span className="text-sm text-[var(--warning-solid)]">
											{t('settings.llm.savedNotActive')}
										</span>
									</>
								)}
							</div>
						</div>
					)}

					{/* Save Button */}
					<div className="flex justify-end">
						<Button
							onClick={handleSave}
							disabled={!isFormValid() || saving}
							className="!bg-[var(--brand-gradient)] hover:!opacity-90 !text-black dark:!text-white border-none shadow-lg shadow-orange-500/20"
						>
							{saving ? t('settings.llm.saving') : t('settings.llm.save')}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
