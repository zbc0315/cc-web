import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login, isLocalAccess, getLocalToken } from '@/lib/api';
import { useAuthStore } from '@/lib/stores';
import { MOTION } from '@/lib/motion';

export function LoginPage() {
  const navigate = useNavigate();
  const storeSetToken = useAuthStore((s) => s.setToken);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-login for localhost
  useEffect(() => {
    if (!isLocalAccess()) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await getLocalToken();
        if (!cancelled) {
          storeSetToken(token);
          navigate('/', { replace: true });
        }
      } catch {
        // local-token failed — fall back to normal login form
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, storeSetToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const token = await login(username, password);
      storeSetToken(token);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION.slow}
        className="w-full max-w-sm"
      >
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">CC Web</CardTitle>
            <CardDescription>
              {isLocalAccess() ? 'Connecting locally...' : 'Sign in to manage your Claude projects'}
            </CardDescription>
          </CardHeader>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={MOTION.default}
                    className="text-sm text-destructive"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </CardContent>
            <CardFooter>
              <motion.div className="w-full" whileTap={{ scale: 0.98 }}>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </motion.div>
            </CardFooter>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
