import React from 'react';
import { Layout, Music, Swords, BarChart2 } from 'lucide-react';

interface MobileNavProps {
    activeTab: 'studio' | 'library' | 'battle' | 'analytics';
    onTabChange: (tab: 'studio' | 'library' | 'battle' | 'analytics') => void;
}

const MobileNav: React.FC<MobileNavProps> = ({ activeTab, onTabChange }) => {
    return (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 pb-safe z-50">
            <div className="flex justify-around items-center h-16">
                <button
                    onClick={() => onTabChange('library')}
                    className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${activeTab === 'library' ? 'text-purple-500' : 'text-gray-400'}`}
                >
                    <Music size={20} />
                    <span className="text-[10px] font-medium">Library</span>
                </button>

                <button
                    onClick={() => onTabChange('studio')}
                    className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${activeTab === 'studio' ? 'text-purple-500' : 'text-gray-400'}`}
                >
                    <Layout size={20} />
                    <span className="text-[10px] font-medium">Studio</span>
                </button>

                <button
                    onClick={() => onTabChange('battle')}
                    className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${activeTab === 'battle' ? 'text-red-500' : 'text-gray-400'}`}
                >
                    <Swords size={20} />
                    <span className="text-[10px] font-medium">Battle</span>
                </button>

                <button
                    onClick={() => onTabChange('analytics')}
                    className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${activeTab === 'analytics' ? 'text-purple-500' : 'text-gray-400'}`}
                >
                    <BarChart2 size={20} />
                    <span className="text-[10px] font-medium">AI Feed</span>
                </button>
            </div>
        </div>
    );
};

// Memoize pure UI component
export default React.memo(MobileNav);
