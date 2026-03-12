import React from "react";
import { useTranslation } from "react-i18next";
import { OllamaInstallState } from "../hooks/useModelManager";

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

  if (!isOpen) {return null;}

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t('ollama.required')}
          </h2>
          {!installState.isInstalling && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
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
                <p className="text-gray-600 dark:text-gray-300 mb-2">
                  {t('ollama.requiredDesc', { modelName: modelName || "AI models" })}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('ollama.aboutOllama')}
                </p>
              </div>

              <div className="flex flex-col space-y-3">
                <button
                  onClick={handleInstall}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {t('ollama.installOllama')}
                </button>
                <button
                  onClick={onClose}
                  className="w-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 rounded-lg transition-colors"
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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('ollama.installingTitle')}
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {t('ollama.installingDesc')}
            </p>
            {installState.progress > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${installState.progress}%` }}
                ></div>
              </div>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
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
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                {t('ollama.installedTitle')}
              </h3>
              <p className="text-gray-600 dark:text-gray-300">
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
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('ollama.installFailedTitle')}
            </h3>
            <p className="text-red-600 dark:text-red-400 text-sm mb-4">
              {installState.error}
            </p>
            <div className="flex flex-col space-y-2">
              <button
                onClick={() => {
                  // Reset error state and try again
                  handleInstall();
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {t('common.tryAgain')}
              </button>
              <button
                onClick={onClose}
                className="w-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OllamaInstallPopup;