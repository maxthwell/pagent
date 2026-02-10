"use client";

import { Card, CardContent, CardHeader } from "./ui/card";
import { Button } from "./ui/button";

export type Profile = {
  title: string;
  avatarSvg?: string | null;
  displayName: string;
  nationality?: string | null;
  ethnicity?: string | null;
  specialties?: string | null;
  hobbies?: string | null;
  gender?: string | null;
  age?: number | null;
  contactWechat?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  workExperience?: string | null;
};

export function ProfileModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 p-4 grid place-items-center" onMouseDown={onClose}>
      <div className="w-full max-w-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className="h-12 w-12 rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden flex items-center justify-center"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: profile.avatarSvg ?? "" }}
                />
                <div>
                  <div className="text-lg font-semibold">{profile.displayName}</div>
                  <div className="mt-1 text-sm text-slate-600">{profile.title}</div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              {profile.nationality ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Nationality</div>
                  <div className="mt-1">{profile.nationality}</div>
                </div>
              ) : null}
              {profile.ethnicity ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Ethnicity</div>
                  <div className="mt-1">{profile.ethnicity}</div>
                </div>
              ) : null}
              {profile.gender ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Gender</div>
                  <div className="mt-1">{profile.gender}</div>
                </div>
              ) : null}
              {typeof profile.age === "number" ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Age</div>
                  <div className="mt-1">{profile.age}</div>
                </div>
              ) : null}
              {profile.contactWechat ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">WeChat</div>
                  <div className="mt-1 break-all">{profile.contactWechat}</div>
                </div>
              ) : null}
              {profile.contactPhone ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Phone</div>
                  <div className="mt-1 break-all">{profile.contactPhone}</div>
                </div>
              ) : null}
              {profile.contactEmail ? (
                <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                  <div className="text-xs text-slate-600">Email</div>
                  <div className="mt-1 break-all">{profile.contactEmail}</div>
                </div>
              ) : null}
            </div>

            {profile.specialties ? (
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">Specialties</div>
                <div className="mt-1">{profile.specialties}</div>
              </div>
            ) : null}

            {profile.hobbies ? (
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">Hobbies</div>
                <div className="mt-1">{profile.hobbies}</div>
              </div>
            ) : null}

            {profile.workExperience ? (
              <div className="rounded-xl bg-white ring-1 ring-slate-200 p-3">
                <div className="text-xs text-slate-600">Work experience</div>
                <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{profile.workExperience}</pre>
              </div>
            ) : null}

            {!profile.nationality &&
            !profile.ethnicity &&
            !profile.specialties &&
            !profile.hobbies &&
            !profile.gender &&
            profile.age == null &&
            !profile.contactWechat &&
            !profile.contactPhone &&
            !profile.contactEmail &&
            !profile.workExperience ? (
              <div className="text-sm text-slate-500">No resume details yet.</div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
