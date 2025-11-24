import Header from '../Header';

export default function HeaderExample() {
  const handleThemeToggle = () => console.log('Theme toggle triggered');
  
  return <Header onThemeToggle={handleThemeToggle} isDark={false} />;
}