import { useState, useEffect } from "react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

export function CLIAuthConfirmation() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getAuthHeaders } = useAuth()
    const { t } = useTranslation()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [user, setUser] = useState<{ id: number; username: string } | null>(null)
    const [processing, setProcessing] = useState(false)

    const callbackUrl = searchParams.get('callback_url')
    const deviceName = searchParams.get('device_name') || 'CLI Device'

    useEffect(() => {
        const checkSession = async () => {
            try {
                const res = await fetch('/api/v1/auth/cli/authorize', {
                    headers: getAuthHeaders(),
                })
                if (res.ok) {
                    const data = await res.json()
                    setUser(data.user)
                } else {
                    setError(t('auth.cli.notLoggedIn'))
                }
            } catch {
                setError(t('auth.cli.sessionFailed'))
            } finally {
                setLoading(false)
            }
        }

        if (!callbackUrl) {
            setError(t('auth.cli.missingCallback'))
            setLoading(false)
            return
        }

        checkSession()
    }, [callbackUrl, getAuthHeaders])

    const handleApprove = async () => {
        setProcessing(true)
        try {
            const res = await fetch('/api/v1/auth/cli/authorize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders(),
                },
                body: JSON.stringify({
                    callback_url: callbackUrl,
                    device_name: deviceName,
                }),
            })

            if (res.ok) {
                const data = await res.json()
                // Redirect to the CLI callback URL
                window.location.href = data.redirect_url
            } else {
                setError(t('auth.cli.authFailed'))
                setProcessing(false)
            }
        } catch {
            setError(t('auth.cli.error'))
            setProcessing(false)
        }
    }

    const handleDeny = () => {
        navigate("/")
    }

    if (loading) {
        return (
            <Layout>
                <div className="flex items-center justify-center min-h-screen">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-solid)]"></div>
                </div>
            </Layout>
        )
    }

    if (error) {
        return (
            <Layout>
                <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
                    <div className="bg-[var(--error)]/10 text-[var(--error)] p-4 rounded-[var(--radius-card)] mb-4">
                        {error}
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => navigate("/")}
                    >
                        {t('auth.cli.goHome')}
                    </Button>
                </div>
            </Layout>
        )
    }

    return (
        <Layout>
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
                <div className="bg-[var(--bg-card)] shadow-[var(--shadow-card)] rounded-[var(--radius-card)] p-8 max-w-md w-full text-center border border-[var(--border-subtle)]">
                    <div className="w-16 h-16 bg-[var(--brand-solid)]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-8 h-8 text-[var(--brand-solid)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                    </div>

                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
                        {t('auth.cli.title')}
                    </h1>

                    <p className="text-[var(--text-secondary)] mb-6">
                        {t('auth.cli.description')
                            .replace('{deviceName}', deviceName)
                            .replace('{username}', user?.username ?? '')}
                    </p>

                    <div className="flex flex-col gap-3">
                        <Button
                            variant="brand"
                            onClick={handleApprove}
                            disabled={processing}
                            className="w-full"
                        >
                            {processing ? t('auth.cli.authorizing') : t('auth.cli.approve')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleDeny}
                            disabled={processing}
                            className="w-full"
                        >
                            {t('auth.cli.deny')}
                        </Button>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

