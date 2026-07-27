import React from "react";
import { useTranslation } from "react-i18next";
import { OllamaInstallState } from "../hooks/useModelManager";
import { Modal } from "./ui/modal";

interface OllamaInstallPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: () => Promise<boolean>;
  installState: OllamaInstallState;
  modelName?: string;
}

const OllamaInstallPopup: React.FC<OllamaInstallPopupProps> = ({
  isOpen,
  onClose,
  onInstall,
  installState,
  modelName,
}) => {
  const { t } = useTranslation();
  const titleId = 'ollama-install-title';

  const handleInstall = async () => {
    const success = await onInstall();
    if (success) {
      // Keep popup open briefly to show success, then close
      setTimeout(() => {
        onClose();
      }, 1500);
    }
  };

  return (
    // Dismiss on Escape/backdrop is suppressed mid-install so the user
    // can't accidentally orphan the spawn. `onInstall` keeps running
    // even when the modal closes between attempts, so safe-otherwise.
    <Modal
      open={isOpen}
      onClose={onClose}
      dismissable={!installState.isInstalling}
      labelledBy={titleId}
    >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="font-display text-xl font-semibold tracking-tight text-foreground">
            {t('ollama.required')}
          </h2>
          {!installState.isInstalling && (
            <button
              onClick={onClose}
              className="press-pulse text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        {!installState.isInstalling &&
          !installState.error &&
          installState.progress === 0 && (
            <>
              <div className="mb-4">
                <p className="text-foreground/80 mb-2">
                  {t('ollama.requiredDesc', { modelName: modelName || "AI models" })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('ollama.aboutOllama')}
                </p>
              </div>

              <div className="flex flex-col space-y-3">
                <button
                  onClick={handleInstall}
                  className="press-pulse ripple-glow w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-2 px-4 rounded-lg transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                >
                  {t('ollama.installOllama')}
                </button>
                <button
                  onClick={onClose}
                  className="press-pulse w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}

        {/* Installing State */}
        {installState.isInstalling && (
          <div className="text-center">
            <div className="mb-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto" style={{ borderBottomColor: 'rgb(var(--glow-color))' }} />
            </div>
            <h3 className="font-display text-lg font-medium tracking-tight text-foreground mb-2">
              {t('ollama.installingTitle')}
            </h3>
            <p className="text-foreground/80 mb-4">
              {t('ollama.installingDesc')}
            </p>
            {installState.progress > 0 && (
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${installState.progress}%` }}
                ></div>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {t('ollama.doNotClose')}
            </p>
          </div>
        )}

        {/* Success State */}
        {installState.progress === 100 &&
          !installState.isInstalling &&
          !installState.error && (
            <div className="text-center">
              <div className="mb-4">
                <svg
                  className="w-12 h-12 text-green-500 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="font-display text-lg font-medium tracking-tight text-foreground mb-2">
                {t('ollama.installedTitle')}
              </h3>
              <p className="text-foreground/80">
                {t('ollama.installedDesc')}
              </p>
            </div>
          )}

        {/* Error State */}
        {installState.error && (
          <div className="text-center">
            <div className="mb-4">
              <svg
                className="w-12 h-12 text-red-500 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3 className="font-display text-lg font-medium tracking-tight text-foreground mb-2">
              {t('ollama.installFailedTitle')}
            </h3>
            <p className="text-destructive text-sm mb-4">
              {installState.error}
            </p>
            <div className="flex flex-col space-y-2">
              <button
                onClick={() => {
                  // Reset error state and try again
                  handleInstall();
                }}
                className="press-pulse ripple-glow w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium py-2 px-4 rounded-lg transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
              >
                {t('common.tryAgain')}
              </button>
              <button
                onClick={onClose}
                className="press-pulse w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
};

export default OllamaInstallPopup;