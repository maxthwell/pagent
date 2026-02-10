"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";

type Me = {
  id: string;
  email: string;
  fullName: string | null;
  nationality: string | null;
  ethnicity: string | null;
  specialties: string | null;
  hobbies: string | null;
  gender: string | null;
  age: number | null;
  contact: string | null;
  contactWechat: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  workExperience: string | null;
  avatarSvg: string | null;
};

export default function MePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [nationality, setNationality] = useState("");
  const [ethnicity, setEthnicity] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [contact, setContact] = useState("");
  const [contactWechat, setContactWechat] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [workExperience, setWorkExperience] = useState("");

  const load = async () => {
    setError(null);
    const res = await apiFetch("/v1/auth/me");
    if (!res.ok) {
      setError(`Failed to load profile (${res.status}): ${await res.text().catch(() => "")}`);
      return;
    }
    const data = (await res.json()) as Me;
    setMe(data);
    setFullName(data.fullName ?? "");
    setNationality(data.nationality ?? "");
    setEthnicity(data.ethnicity ?? "");
    setSpecialties(data.specialties ?? "");
    setHobbies(data.hobbies ?? "");
    setGender(data.gender ?? "");
    setAge(data.age != null ? String(data.age) : "");
    setContact(data.contact ?? "");
    setContactWechat(data.contactWechat ?? "");
    setContactPhone(data.contactPhone ?? "");
    setContactEmail(data.contactEmail ?? "");
    setWorkExperience(data.workExperience ?? "");
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My profile</h1>
        <p className="mt-1 text-sm text-slate-600">Your resume shown in chat (avatar, name, and details).</p>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="h-12 w-12 rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: me?.avatarSvg ?? "" }}
              />
              <div>
                <div className="text-sm font-semibold">{me?.email ?? "…"}</div>
                <div className="text-xs text-slate-600">{me?.id ?? ""}</div>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                setError(null);
                const res = await apiFetch("/v1/auth/me", { method: "PUT", body: JSON.stringify({ regenerateAvatar: true }) });
                if (!res.ok) {
                  setError(`Failed to regenerate avatar (${res.status}): ${await res.text().catch(() => "")}`);
                  return;
                }
                await load();
              }}
            >
              Regenerate avatar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Display name</span>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Alex Chen" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Nationality</span>
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. China" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Ethnicity</span>
              <Input value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} placeholder="e.g. Han" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Gender</span>
              <Input value={gender} onChange={(e) => setGender(e.target.value)} placeholder="female/male/nonbinary" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Age</span>
              <Input value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 28" />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Contact</span>
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="email / phone / link" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">WeChat</span>
              <Input value={contactWechat} onChange={(e) => setContactWechat(e.target.value)} placeholder="WeChat ID" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-slate-600">Phone</span>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+86 ..." />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Email (contact)</span>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder={me?.email ?? "you@example.com"} />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Specialties</span>
            <Input value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="e.g. TypeScript, RAG, Security" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Hobbies</span>
            <Input value={hobbies} onChange={(e) => setHobbies(e.target.value)} placeholder="e.g. reading, hiking" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Work experience</span>
            <Textarea value={workExperience} onChange={(e) => setWorkExperience(e.target.value)} rows={5} />
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={load}>
              Reset
            </Button>
            <Button
              onClick={async () => {
                setError(null);
                const res = await apiFetch("/v1/auth/me", {
                  method: "PUT",
                  body: JSON.stringify({
                    fullName: fullName.trim() ? fullName.trim() : null,
                    nationality: nationality.trim() ? nationality.trim() : null,
                    ethnicity: ethnicity.trim() ? ethnicity.trim() : null,
                    specialties: specialties.trim() ? specialties.trim() : null,
                    hobbies: hobbies.trim() ? hobbies.trim() : null,
                    gender: gender.trim() ? gender.trim() : null,
                    age: age.trim() ? Number(age) : null,
                    contact: contact.trim() ? contact.trim() : null,
                    contactWechat: contactWechat.trim() ? contactWechat.trim() : null,
                    contactPhone: contactPhone.trim() ? contactPhone.trim() : null,
                    contactEmail: contactEmail.trim() ? contactEmail.trim() : null,
                    workExperience: workExperience.trim() ? workExperience.trim() : null
                  })
                });
                if (!res.ok) {
                  setError(`Failed to save profile (${res.status}): ${await res.text().catch(() => "")}`);
                  return;
                }
                await load();
              }}
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
