import React from 'react';
import { Link } from 'react-router-dom';

export default function PortalPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <Link to="/" className="bg-green-500 hover:bg-green-600 text-white font-bold py-10 px-4 rounded-lg shadow-lg text-center text-2xl transition duration-300 ease-in-out transform hover:-translate-y-1">
          Webアプリ
        </Link>
        <a href="https://kakomonn.com/account/login" target="_blank" rel="noopener noreferrer" className="bg-green-500 hover:bg-green-600 text-white font-bold py-10 px-4 rounded-lg shadow-lg text-center text-2xl transition duration-300 ease-in-out transform hover:-translate-y-1">
          診断士一次
        </a>
        <a href="https://www.ap-siken.com/apkakomon.php" target="_blank" rel="noopener noreferrer" className="bg-green-500 hover:bg-green-600 text-white font-bold py-10 px-4 rounded-lg shadow-lg text-center text-2xl transition duration-300 ease-in-out transform hover:-translate-y-1">
          応用情報
        </a>
      </div>
    </div>
  );
}
